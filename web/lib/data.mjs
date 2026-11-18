import { query, ping, describeConnection } from "./db.mjs";

export const COUNTED_TABLES = [
  "sampling_points",
  "samples",
  "test_parameters",
  "results",
  "legislations",
  "legislation_limits",
  "compliance_verdicts",
];

export const RECENT_RESULTS_SQL = `
  SELECT
    s.code AS sample_code,
    sp.name AS sampling_point_name,
    s.collected_at,
    s.matrix,
    tp.name AS parameter_name,
    tp.code AS parameter_code,
    COALESCE(r.value_numeric::text, r.value_text) AS result_value,
    r.unit AS result_unit,
    l.short_name AS legislation_short_name,
    l.code AS legislation_code,
    cv.verdict,
    cv.reason,
    ll.limit_kind,
    ll.limit_value,
    ll.limit_lower,
    ll.limit_upper,
    ll.limit_text,
    ll.unit AS limit_unit
  FROM v_compliance_verdicts cv
  JOIN results r ON r.id = cv.result_id
  JOIN samples s ON s.id = r.sample_id
  JOIN sampling_points sp ON sp.id = s.sampling_point_id
  JOIN test_parameters tp ON tp.id = r.parameter_id
  JOIN legislation_limits ll ON ll.id = cv.legislation_limit_id
  JOIN legislations l ON l.id = cv.legislation_id
  ORDER BY s.collected_at DESC, tp.name
  LIMIT 12
`;

const RECENT_SAMPLES_SQL = `
  SELECT
    s.code AS sample_code,
    sp.name AS sampling_point_name,
    s.collected_at,
    s.matrix,
    s.status
  FROM samples s
  JOIN sampling_points sp ON sp.id = s.sampling_point_id
  ORDER BY s.collected_at DESC
  LIMIT 8
`;

async function tableCounts() {
  const entries = await Promise.all(
    COUNTED_TABLES.map(async (name) => {
      const { rows } = await query(`SELECT count(*)::int AS n FROM ${name}`);
      return [name, Number(rows[0].n)];
    }),
  );
  return Object.fromEntries(entries);
}

export async function getOverview() {
  const startedAt = Date.now();
  try {
    const latencyMs = await ping();

    const [migrationsRes, viewsRes, counts, resultsRes, samplesRes] =
      await Promise.all([
        query(
          "SELECT name, applied_at FROM schema_migrations ORDER BY name",
        ),
        query(
          `SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY viewname`,
        ),
        tableCounts(),
        query(RECENT_RESULTS_SQL).catch(() => ({ rows: [] })),
        query(RECENT_SAMPLES_SQL).catch(() => ({ rows: [] })),
      ]);

    const hasSeededRows = counts.samples > 0;

    return {
      ok: true,
      latencyMs,
      durationMs: Date.now() - startedAt,
      connection: describeConnection(),
      serverVersion: (await query("SHOW server_version")).rows[0]
        .server_version,
      counts,
      countsSource: "db",
      migrations: migrationsRes.rows,
      views: viewsRes.rows.map((r) => r.viewname),
      recentResults: hasSeededRows ? resultsRes.rows : [],
      recentSamples: samplesRes.rows,
      hasSamples: hasSeededRows,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: null,
      durationMs: Date.now() - startedAt,
      connection: safeDescribe(),
      serverVersion: null,
      counts: null,
      countsSource: "unavailable",
      migrations: [],
      views: [],
      recentResults: [],
      recentSamples: [],
      hasSamples: false,
      error: err.message,
    };
  }
}

function safeDescribe() {
  try {
    return describeConnection();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Dashboard queries (PRO-8)
 * ------------------------------------------------------------------ */

/**
 * Per sample: how many limits could be applied to its results, and how many
 * of those already carry a live verdict. Drives the "conforme / não
 * avaliado / sem limite" state on every sample row.
 */
const SAMPLE_COVERAGE_SQL = `
  SELECT
    s.id AS sample_id,
    count(DISTINCT ll.id)::int AS applicable_limits,
    count(DISTINCT cv.id)::int AS judged_limits,
    count(DISTINCT r.id)::int AS result_count
  FROM samples s
  LEFT JOIN results r ON r.sample_id = s.id AND r.data_status <> 'rejected'
  LEFT JOIN legislation_limits ll
         ON ll.parameter_id = r.parameter_id
        AND limit_applies_to_matrix(s.matrix, ll.applies_to_matrix)
        AND (ll.effective_from IS NULL OR ll.effective_from <= s.collected_at::date)
        AND (ll.effective_to IS NULL OR ll.effective_to >= s.collected_at::date)
  LEFT JOIN compliance_verdicts cv
         ON cv.result_id = r.id
        AND cv.legislation_limit_id = ll.id
        AND cv.superseded_at IS NULL
  GROUP BY s.id
`;

/**
 * Per sample × law: how many of that law's limits actually cover this
 * sample's measured parameters (matrix + date). Laws with zero covering
 * limits must read "Sem limite aplicável" — never a verdict (PRO-13).
 */
const LAW_COVERAGE_SQL = `
  SELECT
    s.id AS sample_id,
    l.id AS legislation_id,
    count(DISTINCT ll.id)::int AS covering_limits
  FROM samples s
  JOIN results r ON r.sample_id = s.id AND r.data_status <> 'rejected'
  JOIN legislation_limits ll
         ON ll.parameter_id = r.parameter_id
        AND limit_applies_to_matrix(s.matrix, ll.applies_to_matrix)
        AND (ll.effective_from IS NULL OR ll.effective_from <= s.collected_at::date)
        AND (ll.effective_to IS NULL OR ll.effective_to >= s.collected_at::date)
  JOIN legislations l ON l.id = ll.legislation_id
  WHERE $1::uuid IS NULL OR s.id = $1
  GROUP BY s.id, l.id
`;

const LOADED_LAWS_SQL = `
  SELECT id, code, short_name, issuing_body
    FROM legislations
   ORDER BY code
`;

/**
 * Merge the verdict roll-up (only laws with live verdicts) with every loaded
 * law, so each sample reports an explicit state per legislation:
 *   verdict row  -> that law's roll-up
 *   covers, none -> not_evaluated
 *   covers none  -> no_limit ("Sem limite aplicável")
 * Synthetic rows never change the sample-level state: `overallVerdict` only
 * reads compliant/non_compliant/indeterminate.
 */
function fillLawStates(summaryRows, coverageRows, laws) {
  const covByLaw = new Map(
    coverageRows.map((r) => [String(r.legislation_id), Number(r.covering_limits)]),
  );
  const rows = summaryRows.map((r) => ({
    ...r,
    covering_limits: covByLaw.get(String(r.legislation_id)) ?? 0,
  }));
  const seen = new Set(rows.map((r) => String(r.legislation_id)));
  for (const law of laws) {
    if (seen.has(String(law.id))) continue;
    const covering = covByLaw.get(String(law.id)) ?? 0;
    rows.push({
      sample_id: law.sample_id ?? null,
      legislation_id: law.id,
      legislation_code: law.code,
      legislation_short_name: law.short_name,
      issuing_body: law.issuing_body,
      verdict_count: 0,
      compliant_count: 0,
      non_compliant_count: 0,
      indeterminate_count: 0,
      sample_verdict: covering > 0 ? "not_evaluated" : "no_limit",
      covering_limits: covering,
      collected_at: null,
      last_evaluated_at: null,
    });
  }
  rows.sort((a, b) =>
    String(a.legislation_code).localeCompare(String(b.legislation_code)),
  );
  return rows;
}

export async function listSamples({ limit = 200 } = {}) {
  const [samplesRes, summaryRes, coverageRes, lawsRes, lawCovRes] =
    await Promise.all([
      query(
        `SELECT s.id, s.code, s.collected_at, s.matrix, s.status, s.metadata,
                sp.code AS point_code, sp.name AS point_name, sp.source_type
           FROM samples s
           JOIN sampling_points sp ON sp.id = s.sampling_point_id
          ORDER BY s.collected_at DESC
          LIMIT $1`,
        [limit],
      ),
      query(`SELECT * FROM v_sample_compliance_summary`),
      query(SAMPLE_COVERAGE_SQL),
      query(LOADED_LAWS_SQL),
      query(LAW_COVERAGE_SQL, [null]),
    ]);

  const summaryBySample = new Map();
  for (const row of summaryRes.rows) {
    if (!summaryBySample.has(row.sample_id)) {
      summaryBySample.set(row.sample_id, []);
    }
    summaryBySample.get(row.sample_id).push(row);
  }
  const coverageBySample = new Map(
    coverageRes.rows.map((r) => [r.sample_id, r]),
  );
  const lawCovBySample = new Map();
  for (const row of lawCovRes.rows) {
    if (!lawCovBySample.has(row.sample_id)) {
      lawCovBySample.set(row.sample_id, []);
    }
    lawCovBySample.get(row.sample_id).push(row);
  }

  const rows = samplesRes.rows.map((s) => {
    const perLaw = fillLawStates(
      summaryBySample.get(s.id) || [],
      lawCovBySample.get(s.id) || [],
      lawsRes.rows.map((l) => ({ ...l, sample_id: s.id })),
    );
    const coverage = coverageBySample.get(s.id) || {
      applicable_limits: 0,
      judged_limits: 0,
      result_count: 0,
    };
    return { ...s, perLaw, ...coverage, state: sampleState(perLaw, coverage) };
  });

  return rows;
}

/**
 * A sample is:
 * - `no_limit`        — measured, but no loaded limit applies to its matrix/date
 * - `not_evaluated`   — limits apply, no verdict computed yet
 * - `compliant` / `non_compliant` / `indeterminate` — worst verdict wins
 * - `empty`           — nothing measured yet
 */
export function sampleState(perLaw, coverage) {
  if (!coverage || coverage.result_count === 0) return "empty";
  const worst = overallVerdict(perLaw);
  if (worst) return worst;
  if (Number(coverage.applicable_limits) > 0) return "not_evaluated";
  return "no_limit";
}

export function overallVerdict(perLaw) {
  if (!perLaw || !perLaw.length) return null;
  const order = ["non_compliant", "indeterminate", "compliant"];
  for (const v of order) {
    if (perLaw.some((row) => row.sample_verdict === v)) return v;
  }
  return null;
}

export async function getSampleDetail(code) {
  const sampleRes = await query(
    `SELECT s.id, s.code, s.collected_at, s.received_at, s.matrix, s.status,
            s.depth_m, s.temperature_c, s.collected_by, s.field_notes, s.metadata,
            sp.code AS point_code, sp.name AS point_name, sp.source_type,
            sp.water_body, sp.region, sp.address
       FROM samples s
       JOIN sampling_points sp ON sp.id = s.sampling_point_id
      WHERE lower(s.code::text) = lower($1)`,
    [code],
  );
  if (!sampleRes.rows.length) return null;
  const sample = sampleRes.rows[0];

  const [resultsRes, coverageRes, summaryRes, lawsRes, lawCovRes] =
    await Promise.all([
      query(
        `SELECT r.id, r.replicate, r.value_numeric, r.value_text, r.unit,
                r.censored, r.data_status, r.detection_limit, r.laboratory,
                r.measured_at, r.reported_at, r.notes,
                tp.code AS parameter_code, tp.name AS parameter_name,
                tp.category AS parameter_category, tp.unit AS parameter_unit
           FROM results r
           JOIN test_parameters tp ON tp.id = r.parameter_id
          WHERE r.sample_id = $1
          ORDER BY tp.category, tp.name, r.replicate`,
        [sample.id],
      ),
      query(SAMPLE_COVERAGE_SQL).catch(() => ({ rows: [] })),
      query(
        `SELECT * FROM v_sample_compliance_summary WHERE sample_id = $1`,
        [sample.id],
      ),
      query(LOADED_LAWS_SQL),
      query(LAW_COVERAGE_SQL, [sample.id]),
    ]);

  const judgeRes = await query(
    `SELECT r.id AS result_id,
            ll.id AS limit_id, ll.limit_kind, ll.limit_value, ll.limit_lower,
            ll.limit_upper, ll.limit_text, ll.unit, ll.limit_tier, ll.basis,
            ll.citation, ll.applies_to_matrix, ll.conversion_status,
            l.short_name AS law_short_name, l.code AS law_code,
            cv.verdict, cv.reason, cv.evaluated_at, cv.evaluated_by, cv.rule_version
       FROM results r
       JOIN samples s ON s.id = r.sample_id
       JOIN legislation_limits ll
              ON ll.parameter_id = r.parameter_id
             AND limit_applies_to_matrix(s.matrix, ll.applies_to_matrix)
             AND (ll.effective_from IS NULL OR ll.effective_from <= s.collected_at::date)
             AND (ll.effective_to IS NULL OR ll.effective_to >= s.collected_at::date)
       JOIN legislations l ON l.id = ll.legislation_id
       LEFT JOIN compliance_verdicts cv
              ON cv.result_id = r.id
             AND cv.legislation_limit_id = ll.id
             AND cv.superseded_at IS NULL
      WHERE s.id = $1
      ORDER BY l.short_name, ll.limit_tier, ll.limit_kind`,
    [sample.id],
  );

  const coverage =
    coverageRes.rows.find((r) => r.sample_id === sample.id) || {
      applicable_limits: 0,
      judged_limits: 0,
      result_count: resultsRes.rows.length,
    };
  const perLaw = fillLawStates(
    summaryRes.rows,
    lawCovRes.rows,
    lawsRes.rows.map((l) => ({ ...l, sample_id: sample.id })),
  );
  const judgesByResult = new Map();
  for (const row of judgeRes.rows) {
    if (!judgesByResult.has(row.result_id)) {
      judgesByResult.set(row.result_id, []);
    }
    judgesByResult.get(row.result_id).push(row);
  }

  return {
    sample,
    results: resultsRes.rows.map((r) => ({
      ...r,
      judges: judgesByResult.get(r.id) || [],
    })),
    perLaw,
    ...coverage,
    state: sampleState(perLaw, coverage),
  };
}

export async function getParameterCatalog({ onlyWithLimits = false } = {}) {
  const res = await query(`
    SELECT tp.id, tp.code, tp.name, tp.category, tp.data_type, tp.unit,
           tp.detection_limit, tp.ideal_range_lower, tp.ideal_range_upper,
           (SELECT count(*)::int FROM legislation_limits ll
             WHERE ll.parameter_id = tp.id) AS limit_count,
           (SELECT count(*)::int FROM results r
             WHERE r.parameter_id = tp.id AND r.data_status <> 'rejected') AS result_count,
           (SELECT max(s.collected_at) FROM results r
             JOIN samples s ON s.id = r.sample_id
            WHERE r.parameter_id = tp.id) AS last_measured_at
      FROM test_parameters tp
     WHERE tp.active
     ORDER BY tp.category, tp.sort_order, tp.name
  `);
  const rows = res.rows;
  return onlyWithLimits ? rows.filter((r) => r.limit_count > 0) : rows;
}

export async function getParameterByCode(code) {
  const res = await query(
    `SELECT id, code, name, category, data_type, unit, detection_limit,
            reporting_limit, ideal_range_lower, ideal_range_upper, description,
            method_reference, synonyms
       FROM test_parameters
      WHERE lower(code::text) = lower($1)`,
    [code],
  );
  return res.rows[0] || null;
}

/** Results over time for one parameter, plus every loaded limit as a reference. */
export async function getTimeline(code) {
  const parameter = await getParameterByCode(code);
  if (!parameter) return null;

  const [resultsRes, limitsRes, verdictRes] = await Promise.all([
    query(
      `SELECT r.value_numeric, r.value_text, r.unit, r.censored, r.data_status,
              s.code AS sample_code, s.collected_at, s.matrix,
              sp.name AS point_name
         FROM results r
         JOIN samples s ON s.id = r.sample_id
         JOIN sampling_points sp ON sp.id = s.sampling_point_id
        WHERE r.parameter_id = $1
          AND r.value_numeric IS NOT NULL
          AND r.data_status <> 'rejected'
        ORDER BY s.collected_at`,
      [parameter.id],
    ),
    query(
      `SELECT ll.limit_kind, ll.limit_value, ll.limit_lower, ll.limit_upper,
              ll.unit, ll.applies_to_matrix, ll.limit_tier,
              l.short_name AS law_short_name, l.code AS law_code
         FROM legislation_limits ll
         JOIN legislations l ON l.id = ll.legislation_id
        WHERE ll.parameter_id = $1
        ORDER BY l.short_name`,
      [parameter.id],
    ),
    query(
      `SELECT cv.verdict, s.code AS sample_code, l.short_name AS law_short_name,
              l.code AS law_code
         FROM v_compliance_verdicts cv
         JOIN results r ON r.id = cv.result_id
         JOIN samples s ON s.id = r.sample_id
         JOIN legislations l ON l.id = cv.legislation_id
        WHERE r.parameter_id = $1`,
      [parameter.id],
    ),
  ]);

  return {
    parameter,
    results: resultsRes.rows,
    limits: limitsRes.rows,
    verdicts: verdictRes.rows,
  };
}

/** One parameter across every legislation + the values measured for it. */
export async function getComparative(code) {
  const parameter = await getParameterByCode(code);
  if (!parameter) return null;

  const [limitsRes, resultsRes, verdictRes] = await Promise.all([
    query(
      `SELECT ll.id, ll.limit_kind, ll.limit_value, ll.limit_lower, ll.limit_upper,
              ll.limit_text, ll.unit, ll.applies_to_matrix, ll.limit_tier, ll.basis,
              ll.assessment_window, ll.citation, ll.effective_from, ll.effective_to,
              ll.published_value, ll.published_lower, ll.published_upper,
              ll.published_unit, ll.conversion_status, ll.conversion_note,
              l.short_name AS law_short_name, l.code AS law_code,
              l.issuing_body, l.jurisdiction
         FROM legislation_limits ll
         JOIN legislations l ON l.id = ll.legislation_id
        WHERE ll.parameter_id = $1
        ORDER BY l.short_name, ll.limit_tier`,
      [parameter.id],
    ),
    query(
      `SELECT r.value_numeric, r.value_text, r.unit, r.censored, r.data_status,
              s.code AS sample_code, s.collected_at, s.matrix,
              sp.name AS point_name
         FROM results r
         JOIN samples s ON s.id = r.sample_id
         JOIN sampling_points sp ON sp.id = s.sampling_point_id
        WHERE r.parameter_id = $1 AND r.data_status <> 'rejected'
        ORDER BY s.collected_at DESC
        LIMIT 25`,
      [parameter.id],
    ),
    query(
      `SELECT cv.verdict, cv.reason, s.code AS sample_code, s.collected_at,
              l.short_name AS law_short_name, l.code AS law_code,
              cv.evaluated_at, cv.evaluated_by
         FROM v_compliance_verdicts cv
         JOIN results r ON r.id = cv.result_id
         JOIN samples s ON s.id = r.sample_id
         JOIN legislations l ON l.id = cv.legislation_id
        WHERE r.parameter_id = $1
        ORDER BY s.collected_at DESC, l.short_name`,
      [parameter.id],
    ),
  ]);

  return { parameter, limits: limitsRes.rows, results: resultsRes.rows, verdicts: verdictRes.rows };
}

export async function getLegislations() {
  const res = await query(`
    SELECT l.id, l.code, l.short_name, l.name, l.issuing_body, l.jurisdiction,
           l.effective_from, l.source_url,
           (SELECT count(*)::int FROM legislation_limits ll
             WHERE ll.legislation_id = l.id) AS limit_count
      FROM legislations l
     ORDER BY l.short_name
  `);
  return res.rows;
}

export async function getLimits({ lawCode = null, parameterCode = null } = {}) {
  const [limitsRes, lawParamCounts] = await Promise.all([
    query(
      `SELECT ll.id, ll.limit_kind, ll.limit_value, ll.limit_lower, ll.limit_upper,
              ll.limit_text, ll.unit, ll.applies_to_matrix, ll.limit_tier, ll.basis,
              ll.assessment_window, ll.citation, ll.effective_from, ll.effective_to,
              ll.published_value, ll.published_lower, ll.published_upper,
              ll.published_unit, ll.conversion_status, ll.conversion_note,
              l.short_name AS law_short_name, l.code AS law_code,
              tp.code AS parameter_code, tp.name AS parameter_name,
              tp.unit AS parameter_unit, tp.category AS parameter_category
         FROM legislation_limits ll
         JOIN legislations l ON l.id = ll.legislation_id
         JOIN test_parameters tp ON tp.id = ll.parameter_id
        WHERE ($1::text IS NULL OR lower(l.code::text) = lower($1))
          AND ($2::text IS NULL OR lower(tp.code::text) = lower($2))
        ORDER BY l.short_name, tp.name, ll.limit_tier`,
      [lawCode, parameterCode],
    ),
    query(`
      SELECT l.code AS law_code, count(*)::int AS total,
             count(*) FILTER (WHERE ll.limit_kind = 'max')::int AS max_count,
             count(*) FILTER (WHERE ll.limit_kind = 'min')::int AS min_count,
             count(*) FILTER (WHERE ll.limit_kind = 'range')::int AS range_count,
             count(*) FILTER (WHERE ll.conversion_status <> 'exact')::int AS converted_count
        FROM legislation_limits ll
        JOIN legislations l ON l.id = ll.legislation_id
       GROUP BY l.code
    `),
  ]);

  return {
    rows: limitsRes.rows,
    statsByLaw: Object.fromEntries(
      lawParamCounts.rows.map((r) => [r.law_code, r]),
    ),
  };
}

/** KPI roll-up for the landing page. */
export async function getDashboardKpis() {
  const [counts, verdictTotals, sampleStates, coverage] = await Promise.all([
    tableCounts(),
    query(`
      SELECT
        count(*)::int AS verdicts_total,
        count(*) FILTER (WHERE verdict = 'compliant')::int AS compliant,
        count(*) FILTER (WHERE verdict = 'non_compliant')::int AS non_compliant,
        count(*) FILTER (WHERE verdict = 'indeterminate')::int AS indeterminate,
        count(DISTINCT result_id)::int AS results_judged
        FROM compliance_verdicts
       WHERE superseded_at IS NULL
    `),
    query(`
      SELECT count(*)::int AS samples_total,
             count(*) FILTER (WHERE status = 'reported')::int AS reported
        FROM samples
    `),
    query(SAMPLE_COVERAGE_SQL),
  ]);

  const parametersWithLimitsRes = await query(`
    SELECT count(DISTINCT parameter_id)::int AS n FROM legislation_limits
  `);
  const parametersMeasuredRes = await query(`
    SELECT count(DISTINCT parameter_id)::int AS n FROM results
     WHERE data_status <> 'rejected'
  `);

  return {
    counts,
    verdicts: verdictTotals.rows[0],
    samples: sampleStates.rows[0],
    coverage: coverage.rows,
    parametersWithLimits: Number(parametersWithLimitsRes.rows[0].n),
    parametersMeasured: Number(parametersMeasuredRes.rows[0].n),
  };
}

/** True when the loaded samples/results were produced by seed/demo.mjs. */
export async function hasDemoData() {
  try {
    const res = await query(`
      SELECT EXISTS (
        SELECT 1 FROM samples WHERE metadata->>'demo' = 'true'
      ) AS demo
    `);
    return Boolean(res.rows[0].demo);
  } catch {
    return false;
  }
}
