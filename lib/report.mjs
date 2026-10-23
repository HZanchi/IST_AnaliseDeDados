/**
 * Gerador de relatório de ensaio (PRO-19) — contra o contrato PRO-5
 * (`docs/PRO-5-report-output-spec.md`, v6).
 *
 * Este módulo SÓ monta o modelo do relatório (consultas + derivações de
 * estado). A renderização é `pages/report.mjs`.
 *
 * Regras que este arquivo carrega (todas do spec):
 *  - §2.8 o renderer nunca recalcula veredito: lê `compliance_verdicts` com
 *    `superseded_at IS NULL`.
 *  - §5.1/§5.2 uma única escala de severidade por resultado e por amostra.
 *  - §5.2 a lei vinculante é parâmetro de renderização, nunca coluna.
 *  - §2.9/§7 item 7 regras compostas são avaliadas aqui (soma/média de
 *    razões): entrada ausente ou não final → Indeterminado, nunca
 *    "Sem limite aplicável" e nunca o "não modelado" aposentado.
 */
import { query, describeConnection } from "./db.mjs";
import {
  VERDICT_LABEL,
  VERDICT_KIND,
  formatNumber,
  formatDateBR,
  formatDateTimeBR,
  matrixLabel,
  limitTierLabel,
  basisLabel,
  resultPhrase,
} from "./format.mjs";

/** Lei vinculante padrão do IST (PRO-5 §7 item 2). */
export const DEFAULT_TARGET_CODE = "CONAMA-357-2005";

/** Tokens de consulta que significam "nenhuma lei vinculante". */
export const NO_TARGET_TOKENS = new Set([
  "",
  "nenhuma",
  "nenhum",
  "none",
  "sem",
  "off",
  "todas",
  "all",
]);

const LAW_ORDER = [
  "CONAMA-357-2005",
  "WHO-GDWQ",
  "EU-2020-2184",
  "EPA-NPDWR",
];
const TIER_ORDER = [
  "maximum",
  "action_level",
  "treatment_technique",
  "aesthetic",
  "guideline",
];
const BASIS_ORDER = [
  "single_sample",
  "running_average",
  "periodic_average",
  "frequency",
];

/** PRO-5 §5.2 — a escala única, do pior para o melhor. */
export const ROLLUP_LADDER = [
  "non_compliant",
  "indeterminate",
  "not_evaluated",
  "no_limit",
  "compliant",
];

/** Os cinco estados do PRO-5 §1. Regra composta avaliada não abre sexto estado. */
export const STATE_LABEL = { ...VERDICT_LABEL };

export const STATE_KIND = { ...VERDICT_KIND };

export class ReportError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = "ReportError";
    this.status = status;
  }
}

export function stateLabel(state) {
  return STATE_LABEL[state] || state || "—";
}

export function stateKind(state) {
  return STATE_KIND[state] || "neutral";
}

/* ------------------------------------------------------------------ *
 * Consultas
 * ------------------------------------------------------------------ */

const SAMPLE_SQL = `
  SELECT s.id, s.code, s.collected_at, s.received_at, s.matrix, s.status,
         s.collected_by, s.field_notes, s.metadata,
         sp.code AS point_code, sp.name AS point_name, sp.region,
         sp.water_body, sp.address, sp.source_type
    FROM samples s
    JOIN sampling_points sp ON sp.id = s.sampling_point_id
   WHERE lower(s.code::text) = lower($1)
`;

const RESULTS_SQL = `
  SELECT r.id, r.replicate, r.value_numeric, r.value_text, r.unit, r.censored,
         r.data_status, r.detection_limit, r.method_code, r.measured_at,
         r.reported_at, r.laboratory,
         tp.id AS parameter_id, tp.code AS parameter_code, tp.name AS parameter_name,
         tp.category AS parameter_category, tp.unit AS parameter_unit,
         tp.method_reference, tp.detection_limit AS catalog_detection_limit
    FROM results r
    JOIN test_parameters tp ON tp.id = r.parameter_id
   WHERE r.sample_id = $1
   ORDER BY tp.category, tp.name, r.replicate
`;

/**
 * §2.1 — limite aplicável = parâmetro + predicado de matriz
 * `limit_applies_to_matrix()` + janela de vigência (limite OU lei).
 * §2.8 — o veredito vem do banco, nunca é recalculado aqui.
 */
const LIMITS_SQL = `
  SELECT r.id AS result_id,
         tp.id AS parameter_id, tp.code AS parameter_code,
         tp.name AS parameter_name, tp.method_reference,
         ll.id AS limit_id, ll.limit_kind, ll.limit_value, ll.limit_lower,
         ll.limit_upper, ll.limit_text, ll.unit AS limit_unit,
         ll.limit_tier, ll.basis, ll.assessment_window, ll.citation,
         ll.applies_to_matrix, ll.conversion_status, ll.conversion_note,
         ll.published_value, ll.published_lower, ll.published_upper,
         ll.published_unit,
         ll.effective_from AS limit_effective_from,
         ll.effective_to AS limit_effective_to,
         l.id AS legislation_id, l.code AS legislation_code,
         l.short_name AS legislation_short_name, l.jurisdiction,
         l.document_reference, l.publication_date,
         l.effective_from AS law_effective_from,
         l.effective_to AS law_effective_to,
         cv.id AS verdict_id, cv.verdict, cv.reason, cv.rule_version,
         cv.evaluated_by, cv.evaluated_at
    FROM results r
    JOIN samples s ON s.id = r.sample_id
    JOIN test_parameters tp ON tp.id = r.parameter_id
    JOIN legislation_limits ll
           ON ll.parameter_id = r.parameter_id
          AND limit_applies_to_matrix(s.matrix, ll.applies_to_matrix)
    JOIN legislations l ON l.id = ll.legislation_id
    LEFT JOIN compliance_verdicts cv
           ON cv.result_id = r.id
          AND cv.legislation_limit_id = ll.id
          AND cv.superseded_at IS NULL
   WHERE s.id = $1
     AND (coalesce(ll.effective_from, l.effective_from) IS NULL
          OR coalesce(ll.effective_from, l.effective_from) <= s.collected_at::date)
     AND (coalesce(ll.effective_to, l.effective_to) IS NULL
          OR coalesce(ll.effective_to, l.effective_to) >= s.collected_at::date)
   ORDER BY l.code, ll.limit_tier, ll.basis
`;

const LAWS_SQL = `
  SELECT id, code, short_name, name, issuing_body, jurisdiction,
         document_reference, publication_date, effective_from, effective_to,
         applies_to_matrix,
         (SELECT count(*)::int FROM legislation_limits ll
           WHERE ll.legislation_id = l.id) AS limit_count
    FROM legislations l
`;

const LAW_SCOPES_SQL = `
  SELECT legislation_id, applies_to_matrix, count(*)::int AS n
    FROM legislation_limits
   GROUP BY legislation_id, applies_to_matrix
`;

const SUMMARY_SQL = `
  SELECT * FROM v_sample_compliance_summary WHERE sample_id = $1
`;

/**
 * Regras compostas (PRO-17 / migração 0006) aplicáveis à amostra. O relatório
 * NÃO deriva veredito delas — apenas evita que "Sem limite aplicável" apareça
 * onde a lei cobre o caso por uma regra multi-entrada (PRO-5 §7 item 7).
 */
const COMPOSITES_SQL = `
  SELECT cl.id, cl.rule_code, cl.rule_kind, cl.basis, cl.limit_tier,
         cl.limit_kind, cl.limit_value, cl.limit_lower, cl.limit_upper,
         cl.limit_text, cl.unit, cl.published_value, cl.published_lower,
         cl.published_upper, cl.published_unit, cl.conversion_status,
         cl.conversion_note, cl.assessment_window,
         cl.effective_from AS limit_effective_from,
         cl.effective_to AS limit_effective_to,
         cl.citation, cl.applies_to_matrix, cl.metadata,
         l.id AS legislation_id, l.code AS legislation_code,
         l.short_name AS legislation_short_name, l.document_reference
    FROM composite_limits cl
    JOIN legislations l ON l.id = cl.legislation_id
   WHERE limit_applies_to_matrix($1::water_matrix, cl.applies_to_matrix)
     AND (coalesce(cl.effective_from, l.effective_from) IS NULL
          OR coalesce(cl.effective_from, l.effective_from) <= $2::date)
     AND (coalesce(cl.effective_to, l.effective_to) IS NULL
          OR coalesce(cl.effective_to, l.effective_to) >= $2::date)
   ORDER BY l.code, cl.rule_code
`;

/** Termos da regra (§2.9): coeficiente + referência publicada/canônica. */
const COMPOSITE_INPUTS_SQL = `
  SELECT cli.composite_limit_id, cli.ordinal, cli.coefficient,
         cli.reference_value, cli.reference_unit,
         cli.reference_published_value, cli.reference_published_unit,
         cli.conversion_status AS reference_conversion_status,
         tp.id AS parameter_id, tp.code AS parameter_code,
         tp.name AS parameter_name, tp.unit AS parameter_unit
    FROM composite_limit_inputs cli
    JOIN test_parameters tp ON tp.id = cli.parameter_id
   ORDER BY cli.composite_limit_id, cli.ordinal
`;

async function loadComposites(sample) {
  try {
    const [rulesRes, inputsRes] = await Promise.all([
      query(COMPOSITES_SQL, [sample.matrix, sample.collected_at]),
      query(COMPOSITE_INPUTS_SQL),
    ]);
    const inputsByRule = new Map();
    for (const row of inputsRes.rows) {
      const key = String(row.composite_limit_id);
      if (!inputsByRule.has(key)) inputsByRule.set(key, []);
      inputsByRule.get(key).push(row);
    }
    return rulesRes.rows.map((rule) => {
      const inputs = inputsByRule.get(String(rule.id)) || [];
      return {
        ...rule,
        inputs,
        input_codes: inputs.map((i) => i.parameter_code),
      };
    });
  } catch {
    // Banco anterior à migração 0006 (PRO-17) — sem regras compostas.
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Textos do spec (pt-BR canônico)
 * ------------------------------------------------------------------ */

export const LEGEND_ITEMS = [
  {
    state: "compliant",
    text: "medida dentro do limite aplicável",
  },
  {
    state: "non_compliant",
    text: "medida fora do limite aplicável",
  },
  {
    state: "indeterminate",
    text: "não pode ser julgado (censuramento, conversão ambígua, resultado preliminar ou limite textual)",
  },
  {
    state: "no_limit",
    text: "a lei não cobre este caso: nenhum limite ativo cobre o parâmetro nesta matriz e nesta data",
  },
  {
    state: "not_evaluated",
    text: "limite existe, mas não há veredito vivo registrado (ainda não computado, ou veredito aposentado em edição)",
  },
];

/* ------------------------------------------------------------------ *
 * Formatação de limite (PRO-5 §3.2, §4.1, §6.1/§6.2)
 * ------------------------------------------------------------------ */

function fmt(value) {
  return formatNumber(value, { maxDigits: 6 });
}

/**
 * Forma publicada — a lei nunca é reescrita.
 * `operator: true` prefixa `≥` para limites mínimos (formato da tabela, §3.2);
 * as citações ficam sem operador, como o SQL de referência do §6.2.
 */
export function publishedForm(limit, { operator = false } = {}) {
  if (!limit) return "—";
  const unit = limit.published_unit ? ` ${limit.published_unit}` : "";
  switch (limit.limit_kind) {
    case "text":
      return `texto: "${limit.limit_text ?? ""}"`;
    case "range":
      return `${fmt(limit.published_lower)}–${fmt(limit.published_upper)}${unit}`;
    case "min":
      return `${operator ? "≥ " : ""}${fmt(limit.published_value)}${unit}`;
    default:
      return `${fmt(limit.published_value)}${unit}`;
  }
}

/** Forma normalizada (canônica) — `— (pendente)` quando a conversão é ambígua. */
export function canonicalForm(limit, { operator = false } = {}) {
  if (!limit) return "—";
  if (limit.conversion_status === "ambiguous") return "— (pendente)";
  if (limit.limit_kind === "text") return "—";
  const unitValue = limit.limit_unit ?? limit.unit;
  const unit = unitValue ? ` ${unitValue}` : "";
  switch (limit.limit_kind) {
    case "range":
      return `${fmt(limit.limit_lower)}–${fmt(limit.limit_upper)}${unit}`;
    case "min":
      return `${operator ? "≥ " : ""}${fmt(limit.limit_value)}${unit}`;
    default:
      return `${fmt(limit.limit_value)}${unit}`;
  }
}

/** §6 — vigência. Datas efetivas ainda são NULL: usa a publicação. */
export function vigenciaText(limit, law) {
  const from = limit?.limit_effective_from || law?.effective_from || null;
  const to = limit?.limit_effective_to || law?.effective_to || null;
  if (from || to) {
    return `de ${from ? formatDateBR(from) : "não registrado"} a ${
      to ? formatDateBR(to) : "atual"
    }`;
  }
  if (law?.publication_date) {
    return `publicada em ${formatDateBR(law.publication_date)} (vigência não registrada)`;
  }
  return "não registrada";
}

function matrixScopeText(scope) {
  if (!scope) return "—";
  if (scope === "any") return "todas as matrizes";
  return `${matrixLabel(scope)} (\`${scope}\`)`;
}

/** §6 camada 1 — linha composta de identificação, ordem estável. */
export function layerOneLine(limit) {
  const tier = limitTierLabel(limit.limit_tier);
  const basis = basisLabel(limit.basis);
  return (
    `${limit.legislation_short_name} (${limit.jurisdiction ?? "—"}), ` +
    `parâmetro: ${limit.parameter_name} (${limit.parameter_code}), ` +
    `matriz: ${matrixScopeText(limit.applies_to_matrix)}, ` +
    `${tier}, ${basis}, ` +
    `publicado: ${publishedForm(limit)}, ` +
    `normalizado: ${canonicalForm(limit)}, ` +
    `vigência: ${vigenciaText(limit, limit)}.`
  );
}

/** Método do ensaio: código do resultado, senão o padrão do catálogo (§6). */
export function methodFor(result) {
  return result.method_code || result.method_reference || null;
}

function lawRank(code) {
  const i = LAW_ORDER.indexOf(code);
  return i === -1 ? LAW_ORDER.length : i;
}

function tierRank(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return i === -1 ? TIER_ORDER.length : i;
}

function basisRank(basis) {
  const i = BASIS_ORDER.indexOf(basis);
  return i === -1 ? BASIS_ORDER.length : i;
}

function byLimitOrder(a, b) {
  return (
    lawRank(a.legislation_code) - lawRank(b.legislation_code) ||
    tierRank(a.limit_tier) - tierRank(b.limit_tier) ||
    basisRank(a.basis) - basisRank(b.basis) ||
    String(a.parameter_name).localeCompare(String(b.parameter_name), "pt-BR")
  );
}

/** Ordenação das citações (§6): mesma escala de lei/nível/base, limite antes da regra. */
function entryLawCode(entry) {
  return entry.kind === "limit"
    ? entry.limit.legislation_code
    : entry.composite.legislation_code;
}
function entryTier(entry) {
  return entry.kind === "limit" ? entry.limit.limit_tier : entry.composite.limit_tier;
}
function entryBasis(entry) {
  return entry.kind === "limit" ? entry.limit.basis : entry.composite.basis;
}
function entryName(entry) {
  return entry.kind === "limit" ? entry.limit.parameter_name : entry.composite.rule_code;
}

/* ------------------------------------------------------------------ *
 * Derivação de estado (PRO-5 §1, §2.4, §5.1, §5.2)
 * ------------------------------------------------------------------ */

/** Um limite só julga quando é de amostra individual E tem veredito vivo. */
function isJudged(limit) {
  return limit.basis === "single_sample" && Boolean(limit.verdict);
}

/** Estado de uma linha de limite. §2.4: base ≠ amostra individual → Não avaliado. */
export function limitState(limit) {
  if (!isJudged(limit)) return "not_evaluated";
  return limit.verdict;
}

/**
 * §5.1 — estado de um RESULTADO.
 * 1 zero limites aplicáveis → Sem limite aplicável
 * 2 algum julgado não conforme → Não conforme
 * 3 algum julgado indeterminado → Indeterminado
 * 4 algum limite sem veredito vivo → Não avaliado
 * 5 senão → Conforme
 *
 * `lawId` restringe a contagem a uma lei (§5.2 — a lei vinculante).
 */
export function resultState(limits, lawId = null) {
  const applicable = lawId
    ? limits.filter((l) => String(l.legislation_id) === String(lawId))
    : limits;
  if (!applicable.length) return "no_limit";
  const judged = applicable.filter(isJudged);
  if (judged.some((l) => l.verdict === "non_compliant")) return "non_compliant";
  if (judged.some((l) => l.verdict === "indeterminate")) return "indeterminate";
  if (applicable.some((l) => !isJudged(l))) return "not_evaluated";
  return "compliant";
}

/** §5.2 — a escala única aplicada a um conjunto de estados de resultado. */
export function rollup(states) {
  for (const state of ROLLUP_LADDER) {
    if (states.includes(state)) return state;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Regras compostas (PRO-5 §2.9, §7 item 7)
 * ------------------------------------------------------------------ */

/**
 * §2.9 — o agregado não vive em `compliance_verdicts` (aquela tabela guarda
 * 1 resultado × 1 limite), então o relatório deriva a regra aqui:
 *
 *  - entrada não medida / não final / fora da unidade canônica →
 *    **Indeterminado** com a entrada nomeada (nunca "Sem limite aplicável");
 *  - todos os termos presentes → compara a expressão com o limite da regra.
 */
export function evaluateComposite(composite, resultsByCode) {
  const problems = [];
  let total = 0;

  for (const input of composite.inputs || []) {
    const result = resultsByCode.get(String(input.parameter_code));
    const name = `${input.parameter_name} (${input.parameter_code})`;
    if (!result) {
      problems.push(`${name}: não medido nesta amostra`);
      continue;
    }
    if (result.data_status !== "final") {
      problems.push(`${name}: resultado ${result.data_status}`);
      continue;
    }
    if (result.value_numeric === null || result.value_numeric === undefined) {
      problems.push(`${name}: sem valor numérico`);
      continue;
    }
    if (
      result.unit &&
      input.parameter_unit &&
      result.unit !== input.parameter_unit
    ) {
      problems.push(
        `${name}: unidade ${result.unit} fora da canônica ${input.parameter_unit}`,
      );
      continue;
    }
    const coefficient = Number(input.coefficient ?? 1);
    if (composite.rule_kind === "ratio_sum") {
      if (!input.reference_value) {
        problems.push(`${name}: sem valor de referência da razão`);
        continue;
      }
      total += (coefficient * Number(result.value_numeric)) / Number(input.reference_value);
    } else {
      total += coefficient * Number(result.value_numeric);
    }
  }

  if (problems.length) {
    return {
      state: "indeterminate",
      value: null,
      valueLabel: null,
      reason: `entrada não julgável: ${problems.join("; ")}`,
    };
  }

  const valueLabel = formatNumber(total, { maxDigits: 4 });
  const base = { value: total, valueLabel, missing: [] };

  switch (composite.limit_kind) {
    case "min": {
      const ok = total >= Number(composite.limit_value);
      return {
        ...base,
        state: ok ? "compliant" : "non_compliant",
        reason: `expressão ${valueLabel} ${ok ? "≥" : "<"} limite ${fmt(composite.limit_value)}`,
      };
    }
    case "range": {
      const lo = Number(composite.limit_lower);
      const hi = Number(composite.limit_upper);
      const ok = total >= lo && total <= hi;
      return {
        ...base,
        state: ok ? "compliant" : "non_compliant",
        reason: `expressão ${valueLabel} ${ok ? "entre" : "fora de"} ${fmt(lo)} e ${fmt(hi)}`,
      };
    }
    case "text":
      return {
        ...base,
        state: "indeterminate",
        valueLabel,
        reason: "limite textual — exige conferência manual",
      };
    default: {
      const ok = total <= Number(composite.limit_value);
      return {
        ...base,
        state: ok ? "compliant" : "non_compliant",
        reason: `expressão ${valueLabel} ${ok ? "≤" : ">"} limite ${fmt(composite.limit_value)}`,
      };
    }
  }
}

/** Expressão legível da regra (§4): metadata.rule, senão a forma canônica. */
export function compositeExpression(composite) {
  const fromMetadata = composite.metadata?.rule;
  if (fromMetadata) return fromMetadata;
  const unit = composite.unit ? ` ${composite.unit}` : "";
  return `${composite.rule_kind} ≤ ${fmt(composite.limit_value)}${unit}`;
}

/** §6 — citação da regra composta: camada 1 composta, camada 2 verbatim. */
export function compositeLayerOne(composite, evaluation) {
  const published = publishedForm(composite);
  const canonical = canonicalForm(composite);
  const ratioReferences =
    composite.rule_kind === "ratio_sum"
      ? ` referências publicadas: ${(composite.inputs || [])
          .filter((i) => i.reference_published_value !== null)
          .map(
            (i) =>
              `${fmt(i.reference_published_value)}${
                i.reference_published_unit ? ` ${i.reference_published_unit}` : ""
              }`,
          )
          .join(" + ")} ·`
      : "";
  return (
    `${composite.legislation_short_name}, ` +
    `regra: ${composite.rule_code} (${composite.rule_kind}), ` +
    `matriz: ${matrixScopeText(composite.applies_to_matrix)}, ` +
    `${limitTierLabel(composite.limit_tier)}, ${basisLabel(composite.basis)}, ` +
    `expressão: ${compositeExpression(composite)}, ` +
    `publicado: ${published}, normalizado: ${canonical},${ratioReferences} ` +
    `vigência: ${vigenciaText(composite, composite)}.` +
    (evaluation?.valueLabel ? ` Resultado da expressão: ${evaluation.valueLabel}.` : "")
  );
}

/* ------------------------------------------------------------------ *
 * Montagem do relatório
 * ------------------------------------------------------------------ */

function resolveTarget(rawTarget, laws) {
  if (rawTarget === undefined) {
    const fallback =
      laws.find((l) => l.code.toUpperCase() === DEFAULT_TARGET_CODE) || null;
    return fallback;
  }
  if (rawTarget === null) return null;
  const wanted = String(rawTarget).trim().toLowerCase();
  const hit = laws.find((l) => String(l.code).toLowerCase() === wanted);
  if (!hit) {
    throw new ReportError(
      `Legislação de referência "${rawTarget}" não existe. Use uma lei carregada (${laws
        .map((l) => l.code)
        .join(", ")}) ou "nenhuma".`,
      400,
    );
  }
  return hit;
}

function scopeHint(law, sampleMatrix, scopesByLaw) {
  const scopes = scopesByLaw.get(String(law.id)) || [];
  if (!scopes.length) return "";
  const coversMatrix = scopes.includes(sampleMatrix) || scopes.includes("any");
  if (coversMatrix) return "";
  return `limite \`${scopes.sort().join("/")}\``;
}

/**
 * Monta o relatório de uma amostra. Devolve `null` quando o código não existe.
 *
 * @param {string} sampleCode
 * @param {{ target?: string|null|undefined }} options
 *   `target` indefinido → lei padrão (CONAMA); `null` → nenhuma lei
 *   vinculante (sem conclusão geral, §5.2); string → código da lei.
 */
export async function buildSampleReport(sampleCode, { target: rawTarget } = {}) {
  const sampleRes = await query(SAMPLE_SQL, [sampleCode]);
  if (!sampleRes.rows.length) return null;
  const sample = sampleRes.rows[0];

  const [resultsRes, lawsRes, scopesRes, summaryRes] = await Promise.all([
    query(RESULTS_SQL, [sample.id]),
    query(LAWS_SQL),
    query(LAW_SCOPES_SQL),
    query(SUMMARY_SQL, [sample.id]),
  ]);
  const limitsRes = await query(LIMITS_SQL, [sample.id]);
  const composites = await loadComposites(sample);

  const laws = lawsRes.rows;
  const target = resolveTarget(rawTarget, laws);

  const scopesByLaw = new Map();
  for (const row of scopesRes.rows) {
    const key = String(row.legislation_id);
    if (!scopesByLaw.has(key)) scopesByLaw.set(key, []);
    scopesByLaw.get(key).push(row.applies_to_matrix);
  }

  const limitsByResult = new Map();
  for (const row of limitsRes.rows) {
    if (!limitsByResult.has(row.result_id)) limitsByResult.set(row.result_id, []);
    limitsByResult.get(row.result_id).push(row);
  }
  for (const rows of limitsByResult.values()) rows.sort(byLimitOrder);

  const results = resultsRes.rows.map((r) => ({
    ...r,
    limits: limitsByResult.get(r.id) || [],
  }));

  /* ---- §3.1 linhas da tabela de resultados ---- */
  const resultsByCode = new Map(
    results.map((r) => [String(r.parameter_code), r]),
  );
  /** §2.9 — avaliação de cada regra aplicável, uma por amostra. */
  const evaluationByRule = new Map(
    composites.map((c) => [String(c.id), evaluateComposite(c, resultsByCode)]),
  );
  for (const composite of composites) {
    composite.evaluation = evaluationByRule.get(String(composite.id));
  }

  const resultRows = [];
  for (const result of results) {
    if (result.limits.length) {
      for (const limit of result.limits) {
        resultRows.push({
          result,
          limit,
          state: limitState(limit),
          scopeHint: "",
          composite: null,
        });
      }
      continue;
    }
    // §3.1 — nenhum limite individual aplicável: a cobertura do caso é da
    // linha de regra composta abaixo, nunca um "não modelado" por parâmetro.
    resultRows.push({
      result,
      limit: null,
      state: "no_limit",
      scopeHint: "",
      composite: null,
    });
  }

  // §3.1 — uma linha `Regra composta` por (amostra, regra), depois das linhas
  // por resultado; o agregado não entra na contagem `N de M` de cobertura (§2.9).
  for (const composite of composites) {
    resultRows.push({
      result: null,
      limit: null,
      state: evaluationByRule.get(String(composite.id)).state,
      scopeHint: "",
      composite,
      evaluation: evaluationByRule.get(String(composite.id)),
    });
  }

  /* ---- §5 estados por resultado ---- */
  const statesByResult = new Map();
  for (const result of results) {
    const stateAll = resultState(result.limits);
    const stateTarget = target ? resultState(result.limits, target.id) : null;
    statesByResult.set(result.id, { stateAll, stateTarget });
  }

  /* ---- §5.2 conclusão geral + cobertura ---- */
  const coveredResults = target
    ? results.filter((r) =>
        r.limits.some((l) => String(l.legislation_id) === String(target.id)),
      )
    : [];

  let overall = null;
  if (target) {
    // §2.9/§5.1: a regra composta é de nível de amostra e entra na escala
    // junto com os resultados, sem se colar a um resultado individual.
    const targetComposites = composites.filter(
      (c) => String(c.legislation_id) === String(target.id),
    );
    const states = [
      ...coveredResults.map((r) => statesByResult.get(r.id).stateTarget),
      ...targetComposites.map(
        (c) => evaluationByRule.get(String(c.id)).state,
      ),
    ];
    overall = states.length ? rollup(states) : "no_limit";
  }

  /* ---- §5.3 resumo por legislação ---- */
  const summaryByLaw = new Map(
    summaryRes.rows.map((r) => [String(r.legislation_id), r]),
  );
  const perLaw = laws
    .slice()
    .sort((a, b) => lawRank(a.code) - lawRank(b.code))
    .map((law) => {
      const applicable = results.filter((r) =>
        r.limits.some((l) => String(l.legislation_id) === String(law.id)),
      );
      const covering = new Set();
      for (const r of results) {
        for (const l of r.limits) {
          if (String(l.legislation_id) === String(law.id)) covering.add(l.limit_id);
        }
      }
      const view = summaryByLaw.get(String(law.id));
      const hint = scopeHint(law, sample.matrix, scopesByLaw);
      if (!covering.size) {
        return {
          law,
          covering: 0,
          counts: null,
          state: "no_limit",
          hint,
        };
      }
      const state = applicable.length
        ? rollup(applicable.map((r) => resultState(r.limits, law.id)))
        : "not_evaluated";
      return {
        law,
        covering: covering.size,
        counts: {
          verdict_count: Number(view?.verdict_count ?? 0),
          compliant_count: Number(view?.compliant_count ?? 0),
          non_compliant_count: Number(view?.non_compliant_count ?? 0),
          indeterminate_count: Number(view?.indeterminate_count ?? 0),
        },
        state,
        hint,
      };
    });

  /* ---- §4 tabela comparativa ---- */
  const columns = laws
    .slice()
    .sort((a, b) => lawRank(a.code) - lawRank(b.code))
    .map((law) => ({
      law,
      isTarget: target ? String(law.id) === String(target.id) : false,
      hint: scopeHint(law, sample.matrix, scopesByLaw),
    }));

  const comparison = results.map((result) => ({
    result,
    cells: columns.map((column) => ({
      column,
      lines: comparisonLines(result, column, composites),
    })),
  }));

  /* ---- §6 citações (uma por limite citado, deduplicada) ---- */
  const citationByLimit = new Map();
  const methodByLimit = new Map();
  for (const result of results) {
    for (const limit of result.limits) {
      if (!citationByLimit.has(limit.limit_id)) {
        citationByLimit.set(limit.limit_id, { limit, result });
      }
      const method = methodFor(result);
      if (method) {
        const seen = methodByLimit.get(limit.limit_id) || [];
        if (!seen.includes(method)) {
          seen.push(method);
          methodByLimit.set(limit.limit_id, seen);
        }
      }
    }
  }
  const limitCitations = [...citationByLimit.values()]
    .map(({ limit, result }) => {
      const methods = methodByLimit.get(limit.limit_id) || [];
      return {
        kind: "limit",
        limit,
        result,
        layer1: layerOneLine(limit),
        layer2:
          `${limit.citation} · ${limit.document_reference} · ` +
          `método: ${methods.length ? methods.join(" / ") : "não registrado"}`,
        methods,
      };
    })
    .sort((a, b) => byLimitOrder(a.limit, b.limit));

  /* ---- §6 citação das regras compostas (composite_limits.citation) ---- */
  const compositeCitations = composites.map((composite) => {
    const evaluation = evaluationByRule.get(String(composite.id));
    const methods = [];
    for (const input of composite.inputs || []) {
      const result = resultsByCode.get(String(input.parameter_code));
      const method = result ? methodFor(result) : null;
      if (method && !methods.includes(method)) methods.push(method);
    }
    return {
      kind: "composite",
      composite,
      evaluation,
      state: evaluation.state,
      layer1: compositeLayerOne(composite, evaluation),
      layer2:
        `${composite.citation} · ${composite.document_reference} · ` +
        `método: ${methods.length ? methods.join(" / ") : "não registrado"}`,
      methods,
    };
  });

  const citations = [...limitCitations, ...compositeCitations].sort(
    (a, b) =>
      lawRank(entryLawCode(a)) - lawRank(entryLawCode(b)) ||
      (a.kind === b.kind ? 0 : a.kind === "limit" ? -1 : 1) ||
      tierRank(entryTier(a)) - tierRank(entryTier(b)) ||
      basisRank(entryBasis(a)) - basisRank(entryBasis(b)) ||
      String(entryName(a)).localeCompare(String(entryName(b)), "pt-BR"),
  );

  /* ---- §3/§6 validação: sem nome, não se emite relatório ---- */
  const missing = citations.filter((entry) =>
    entry.kind === "limit"
      ? !entry.limit.citation || !entry.limit.document_reference
      : !entry.composite.citation || !entry.composite.document_reference,
  );
  if (missing.length) {
    const names = missing.map((entry) =>
      entry.kind === "limit"
        ? `${entry.limit.legislation_short_name}/${entry.limit.parameter_code}`
        : `${entry.composite.legislation_short_name}/${entry.composite.rule_code}`,
    );
    throw new ReportError(
      `Relatório recusado (PRO-5 §3): linha julgada sem citação nomeada — ${names.join(", ")}. ` +
        "Toda linha julgada precisa de `citation` em legislation_limits/composite_limits e de `document_reference` na lei.",
      422,
    );
  }

  /* ---- §2.7 proveniência ---- */
  const ruleVersions = [
    ...new Set(results.flatMap((r) => r.limits.map((l) => l.rule_version)).filter(Boolean)),
  ].sort();
  const evaluatedBy = [
    ...new Set(results.flatMap((r) => r.limits.map((l) => l.evaluated_by)).filter(Boolean)),
  ].sort();

  const demoFlag = sample.metadata?.demo;
  const demo =
    demoFlag === true ||
    demoFlag === "true" ||
    evaluatedBy.includes("demo-seed") ||
    ruleVersions.some((v) => String(v).startsWith("demo"));

  let database = "waterquality";
  try {
    database = describeConnection().database;
  } catch {
    /* sem conexão descritível — usa o nome padrão do spec */
  }

  const generatedAt = new Date();

  return {
    reportId: `REL-${sample.code}-${stamp(generatedAt)}`,
    generatedAt,
    extractedAtLabel: formatDateTimeBR(generatedAt),
    sample,
    results,
    statesByResult,
    resultRows,
    columns,
    comparison,
    perLaw,
    laws,
    target,
    overall: target
      ? {
          state: overall,
          coverage: { covered: coveredResults.length, total: results.length },
        }
      : null,
    citations,
    composites,
    provenance: { ruleVersions, evaluatedBy, database },
    demo,
  };
}

/* ------------------------------------------------------------------ *
 * Célula da tabela comparativa (PRO-5 §4)
 * ------------------------------------------------------------------ */

function comparisonLines(result, column, composites) {
  const limits = result.limits.filter(
    (l) => String(l.legislation_id) === String(column.law.id),
  );

  if (!limits.length) {
    // §4: regra composta não cabe em célula de parâmetro, mas a cobertura tem
    // de aparecer — uma linha por (amostra, regra), com a expressão e o estado.
    const rules = composites.filter(
      (c) =>
        String(c.legislation_id) === String(column.law.id) &&
        (c.input_codes || []).includes(result.parameter_code),
    );
    if (rules.length) {
      return rules.map((rule) => ({
        kind: "composite",
        composite: rule,
        text:
          `Regra composta ${rule.rule_code} · ${compositeExpression(rule)}` +
          (rule.evaluation?.valueLabel ? ` · ${rule.evaluation.valueLabel}` : ""),
        state: rule.evaluation.state,
      }));
    }
    return [
      {
        kind: "no_limit",
        text: column.hint
          ? `Sem limite aplicável (${column.hint})`
          : "Sem limite aplicável",
      },
    ];
  }

  return limits.map((limit) => {
    const published = publishedForm(limit, { operator: true });
    const canonical = canonicalForm(limit, { operator: true });
    const parts = [];
    if (limit.conversion_status === "ambiguous") {
      parts.push(`${published} · pendente`);
    } else if (limit.limit_kind === "text") {
      parts.push(published);
    } else if (published !== canonical) {
      parts.push(`${published} → ${canonical}`);
    } else {
      parts.push(published);
    }
    parts.push(
      `${limitTierLabel(limit.limit_tier)}/${basisLabel(limit.basis)}`,
    );
    if (limit.assessment_window) {
      parts.push(`janela: ${limit.assessment_window}`);
    }
    const state = limitState(limit);
    return {
      kind: "limit",
      limit,
      text: parts.join(" · "),
      state,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

/** `YYYYMMDD-HHmm` no fuso do relatório (America/Sao_Paulo). */
function stamp(date) {
  const base = formatDateTimeBR(date); // DD/MM/YYYY HH:MM
  const [datePart, timePart] = base.split(" ");
  const [day, month, year] = datePart.split("/");
  return `${year}${month}${day}-${timePart.replace(":", "")}`;
}

export function resultCell(result) {
  return resultPhrase(result);
}
