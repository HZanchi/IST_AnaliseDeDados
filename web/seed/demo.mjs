#!/usr/bin/env node
/**
 * Dados de demonstração para o dashboard do Projeto IST.
 *
 * Por que existe: o banco ainda não tem amostras/resultados reais — apenas o
 * catálogo de parâmetros e os limites por legislação. Sem linhas em `samples`
 * / `results`, não há o que mostrar em "conformidade por amostra".
 *
 * Regras de segurança:
 *  - só insere quando `samples` está VAZIA (nunca mistura com dados reais);
 *  - tudo é marcado com `metadata.demo = true` e código `DEMO-...`;
 *  - `npm run demo:purge` remove exatamente essas linhas (e nada mais);
 *  - os vereditos gravados aqui usam `rule_version = 'demo-basic-v1'` e
 *    `evaluated_by = 'demo-seed'`, para serem distinguishíveis dos vereditos
 *    oficiais quando as regras do projeto de dados entrarem em produção.
 */
import pg from "pg";
import { databaseUrl } from "../lib/config.mjs";

const { Client } = pg;

const POINTS = [
  {
    code: "PT-RIO-01",
    name: "Rio Itajaí-Açu — Ponte Velha",
    source_type: "surface",
    water_body: "Rio Itajaí-Açu",
    region: "Vale do Itajaí — Blumenau",
    latitude: -26.9051,
    longitude: -49.066,
    description: "Ponto de monitoramento de água superficial (demonstração).",
  },
  {
    code: "PT-RIO-02",
    name: "Rio Itajaí-Açu — Ponte do Ferro",
    source_type: "surface",
    water_body: "Rio Itajaí-Açu",
    region: "Vale do Itajaí — Blumenau",
    latitude: -26.8832,
    longitude: -49.0487,
    description: "Segundo ponto de água superficial, a montante (demonstração).",
  },
  {
    code: "PT-ETA-01",
    name: "ETA Rio do Testo — saída tratada",
    source_type: "treated_distribution",
    water_body: "Sistema de abastecimento",
    region: "Vale do Itajaí — Blumenau",
    latitude: -26.921,
    longitude: -49.0901,
    description: "Água tratada na saída da estação (demonstração).",
  },
];

const SAMPLES = [
  { code: "DEMO-2026-001", point: "PT-RIO-01", collectedAt: "2026-08-26T09:15:00-03:00", matrix: "surface" },
  { code: "DEMO-2026-002", point: "PT-RIO-02", collectedAt: "2026-08-26T10:05:00-03:00", matrix: "surface" },
  { code: "DEMO-2026-003", point: "PT-ETA-01", collectedAt: "2026-09-02T08:40:00-03:00", matrix: "tap" },
  { code: "DEMO-2026-004", point: "PT-RIO-01", collectedAt: "2026-09-09T09:10:00-03:00", matrix: "surface" },
  { code: "DEMO-2026-005", point: "PT-RIO-02", collectedAt: "2026-09-09T10:00:00-03:00", matrix: "surface" },
  { code: "DEMO-2026-006", point: "PT-ETA-01", collectedAt: "2026-09-16T08:35:00-03:00", matrix: "tap" },
  { code: "DEMO-2026-007", point: "PT-RIO-01", collectedAt: "2026-09-23T09:20:00-03:00", matrix: "surface" },
  { code: "DEMO-2026-008", point: "PT-RIO-02", collectedAt: "2026-09-23T10:10:00-03:00", matrix: "surface" },
  { code: "DEMO-2026-009", point: "PT-ETA-01", collectedAt: "2026-09-30T08:30:00-03:00", matrix: "tap" },
  { code: "DEMO-2026-010", point: "PT-RIO-01", collectedAt: "2026-10-07T09:05:00-03:00", matrix: "surface" },
  { code: "DEMO-2026-011", point: "PT-RIO-02", collectedAt: "2026-10-07T10:15:00-03:00", matrix: "surface" },
  { code: "DEMO-2026-012", point: "PT-ETA-01", collectedAt: "2026-10-14T08:45:00-03:00", matrix: "tap" },
];

/** Um valor por amostra, na mesma ordem de SAMPLES. */
const SERIES = {
  ph: [7.2, 7.4, 7.4, 7.1, 7.3, 7.5, 6.9, 7.6, 7.4, 7.2, 9.4, 7.3],
  turbidity: [18, 24, 22, 31, 27, 25, 45, 38, 33, 145, 29, 26],
  dissolved_oxygen: [7.4, 6.9, 6.4, 6.8, 6.2, 5.9, 5.6, 3.9, 5.8, 6.4, 5.1, 6.6],
  nitrate_as_n: [4.2, 3.8, 5.1, 4.6, 5.4, 6.2, 5.8, 6.6, 7.1, 13.8, 6.9, 7.4],
  nitrite_as_n: [0.08, 0.06, 0.12, 0.09, 0.11, 0.15, 0.13, 0.18, 0.16, 0.21, 1.4, 0.19],
  fluoride: [0.4, 0.5, 0.6, 0.5, 0.7, 0.6, 0.8, 0.7, 0.9, 0.8, 0.6, 0.7],
  chloride: [62, 58, 74, 69, 81, 88, 95, 102, 110, 118, 126, 93],
  iron: [0.08, 0.11, 0.09, 0.14, 0.12, 0.18, 0.16, 0.22, 0.19, 0.26, 0.71, 0.24],
  manganese: [0.02, 0.03, 0.03, 0.04, 0.05, 0.04, 0.17, 0.05, 0.07, 0.06, 0.08, 0.06],
  total_dissolved_solids: [180, 165, 210, 195, 230, 245, 260, 290, 310, 340, 380, 275],
  arsenic: [1.2, 0.9, 2.1, 1.8, 2.4, 3.2, 2.8, 4.1, 3.6, 5.2, 4.8, 6.1],
};

/** Resultados censurados (valor abaixo do limite de detecção). */
const CENSORED = [
  { sample: "DEMO-2026-001", parameter: "arsenic" },
];

/** Resultados ainda em estado preliminar (demonstram o veredito indeterminado). */
const PRELIMINARY = [
  { sample: "DEMO-2026-005", parameter: "nitrate_as_n" },
];

const RULE_VERSION = "demo-basic-v1";
const EVALUATED_BY = "demo-seed";

async function main() {
  const purge = process.argv.includes("purge");
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    if (purge) {
      await purgeDemo(client);
    } else {
      await seedDemo(client);
    }
  } catch (err) {
    console.error(`[demo] erro: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

async function purgeDemo(client) {
  const before = await client.query(
    `SELECT count(*)::int AS n FROM samples WHERE metadata->>'demo' = 'true'`,
  );
  const points = await client.query(
    `SELECT count(*)::int AS n FROM sampling_points WHERE metadata->>'demo' = 'true'`,
  );
  if (!before.rows[0].n && !points.rows[0].n) {
    console.log("[demo] nada para remover — não há dados de demonstração.");
    return;
  }
  await client.query("BEGIN");
  try {
    const delSamples = await client.query(
      `DELETE FROM samples WHERE metadata->>'demo' = 'true'`,
    );
    const delPoints = await client.query(
      `DELETE FROM sampling_points WHERE metadata->>'demo' = 'true'`,
    );
    await client.query("COMMIT");
    console.log(
      `[demo] removidos: ${delSamples.rowCount} amostra(s) (resultados e vereditos vão junto por cascata) e ${delPoints.rowCount} ponto(s) de coleta.`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function seedDemo(client) {
  const existing = await client.query(`SELECT count(*)::int AS n FROM samples`);
  if (existing.rows[0].n > 0) {
    console.log(
      `[demo] banco já tem ${existing.rows[0].n} amostra(s) — nada foi inserido. ` +
        `Dados de demonstração só entram em um banco vazio. Para começar do zero: npm run demo:purge (se houver demo) + limpar as amostras reais.`,
    );
    return;
  }

  const limitsCount = await client.query(
    `SELECT count(*)::int AS n FROM legislation_limits`,
  );
  if (!limitsCount.rows[0].n) {
    console.log(
      "[demo] nenhum limite de legislação carregado — rode o seed do projeto de dados antes (npm run db:seed).",
    );
    process.exitCode = 1;
    return;
  }

  const paramsRes = await client.query(
    `SELECT id, code, name, unit, detection_limit FROM test_parameters
      WHERE code = ANY($1::text[])`,
    [Object.keys(SERIES)],
  );
  const paramsByCode = new Map(paramsRes.rows.map((r) => [r.code.toLowerCase(), r]));
  const missing = Object.keys(SERIES).filter((c) => !paramsByCode.has(c));
  if (missing.length) {
    console.log(`[demo] parâmetros ausentes no catálogo: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const limitsRes = await client.query(`
    SELECT ll.*, l.code AS law_code, tp.code AS parameter_code
      FROM legislation_limits ll
      JOIN legislations l ON l.id = ll.legislation_id
      JOIN test_parameters tp ON tp.id = ll.parameter_id
  `);

  await client.query("BEGIN");
  try {
    const pointIds = new Map();
    for (const p of POINTS) {
      const res = await client.query(
        `INSERT INTO sampling_points
           (code, name, source_type, water_body, region, latitude, longitude,
            description, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{"demo":true}'::jsonb)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          p.code,
          p.name,
          p.source_type,
          p.water_body,
          p.region,
          p.latitude,
          p.longitude,
          p.description,
        ],
      );
      pointIds.set(p.code, res.rows[0].id);
    }

    let resultCount = 0;
    let verdictCount = 0;
    let compliant = 0;
    let nonCompliant = 0;
    let indeterminate = 0;
    const censoredSet = new Set(
      CENSORED.map((c) => `${c.sample}|${c.parameter.toLowerCase()}`),
    );
    const preliminarySet = new Set(
      PRELIMINARY.map((c) => `${c.sample}|${c.parameter.toLowerCase()}`),
    );

    for (let i = 0; i < SAMPLES.length; i += 1) {
      const s = SAMPLES[i];
      const collectedAt = new Date(s.collectedAt);
      const sampleRes = await client.query(
        `INSERT INTO samples
           (sampling_point_id, code, collected_at, matrix, status,
            received_at, collected_by, field_notes, metadata)
         VALUES ($1,$2,$3,$4,'reported',$5,$6,$7,'{"demo":true,"fonte":"seed de demonstração"}'::jsonb)
         RETURNING id`,
        [
          pointIds.get(s.point),
          s.code,
          collectedAt,
          s.matrix,
          new Date(collectedAt.getTime() + 3 * 3600 * 1000),
          "Equipe de demonstração",
          "Amostra gerada pelo dashboard para ilustração — substitua por ensaios reais.",
        ],
      );
      const sampleId = sampleRes.rows[0].id;

      for (const [code, values] of Object.entries(SERIES)) {
        const param = paramsByCode.get(code);
        const isCensored = censoredSet.has(`${s.code}|${code}`);
        const isPreliminary = preliminarySet.has(`${s.code}|${code}`);
        const dataStatus = isPreliminary ? "preliminary" : "final";
        const value = isCensored
          ? Number(param.detection_limit ?? values[i])
          : Number(values[i]);

        const res = await client.query(
          `INSERT INTO results
             (sample_id, parameter_id, replicate, value_numeric, unit, censored,
              data_status, laboratory, measured_at, reported_at, metadata)
           VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,'{"demo":true}'::jsonb)
           RETURNING id`,
          [
            sampleId,
            param.id,
            value,
            param.unit,
            isCensored ? "below_dl" : null,
            dataStatus,
            "Laboratório de demonstração",
            new Date(collectedAt.getTime() + 24 * 3600 * 1000),
            new Date(collectedAt.getTime() + 48 * 3600 * 1000),
          ],
        );
        resultCount += 1;

        const applicable = limitsRes.rows.filter(
          (ll) =>
            ll.parameter_code.toLowerCase() === code &&
            // Espelho de limit_applies_to_matrix() no banco (PRO-13): 'any'
            // casa com tudo; um valor físico casa só com a própria matriz;
            // NULL não casa mais (coluna NOT NULL desde 0005_matrix_scope.sql).
            (ll.applies_to_matrix === "any" || ll.applies_to_matrix === s.matrix) &&
            (!ll.effective_from || ll.effective_from <= collectedAt.toISOString().slice(0, 10)) &&
            (!ll.effective_to || ll.effective_to >= collectedAt.toISOString().slice(0, 10)),
        );

        for (const limit of applicable) {
          const outcome = evaluate(value, param.unit, limit, isCensored, dataStatus);
          if (!outcome) continue;
          await client.query(
            `INSERT INTO compliance_verdicts
               (result_id, legislation_limit_id, verdict, evaluated_value_numeric,
                evaluated_unit, reason, limit_snapshot, rule_version, evaluated_by, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              res.rows[0].id,
              limit.id,
              outcome.verdict,
              value,
              param.unit,
              outcome.reason,
              JSON.stringify({
                limit_kind: limit.limit_kind,
                limit_value: limit.limit_value,
                limit_lower: limit.limit_lower,
                limit_upper: limit.limit_upper,
                unit: limit.unit,
                law: limit.law_code,
                citation: limit.citation,
              }),
              RULE_VERSION,
              EVALUATED_BY,
              "veredito de demonstração — regras oficiais do projeto de dados ainda em definição",
            ],
          );
          verdictCount += 1;
          if (outcome.verdict === "compliant") compliant += 1;
          else if (outcome.verdict === "non_compliant") nonCompliant += 1;
          else indeterminate += 1;
        }
      }
    }

    await client.query("COMMIT");
    console.log("[demo] dados de demonstração inseridos:");
    console.log(`  pontos de coleta: ${POINTS.length}`);
    console.log(`  amostras:         ${SAMPLES.length}`);
    console.log(`  resultados:       ${resultCount}`);
    console.log(`  vereditos:        ${verdictCount} (${compliant} conformes, ${nonCompliant} não conformes, ${indeterminate} indeterminados)`);
    console.log("  remova tudo com:  npm run demo:purge");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Regra simples de demonstração (NÃO é a regra oficial do projeto de dados):
 * compara valor canônico contra o limite, respeitando unidade e censura.
 */
function evaluate(value, unit, limit, censored, dataStatus) {
  if (dataStatus === "preliminary") {
    return {
      verdict: "indeterminate",
      reason: "resultado preliminar — aguarda laudo final",
    };
  }
  if (limit.conversion_status === "ambiguous" && (limit.limit_value === null || limit.limit_value === undefined)) {
    return {
      verdict: "indeterminate",
      reason: "limite publicado sem valor canônico — conversão ambígua, exige conferência humana",
    };
  }
  if (unit && limit.unit && unit !== limit.unit) {
    return {
      verdict: "indeterminate",
      reason: `unidade do resultado (${unit}) difere da unidade canônica do limite (${limit.unit})`,
    };
  }
  if (limit.limit_kind === "text") {
    return {
      verdict: "indeterminate",
      reason: "limite textual — exige conferência manual",
    };
  }

  const v = Number(value);
  const cmp = (ok, reasonOk, reasonBad) =>
    ok
      ? { verdict: "compliant", reason: censored ? `censurado (${reasonOk})` : reasonOk }
      : { verdict: "non_compliant", reason: censored ? `censurado (${reasonBad})` : reasonBad };

  if (limit.limit_kind === "max") {
    const lim = Number(limit.limit_value);
    if (censored) {
      // valor censurado: só dá para afirmar conformidade quando o próprio LD
      // já está dentro do limite (o valor real é < LD ≤ limite).
      return v <= lim
        ? { verdict: "compliant", reason: `resultado abaixo do limite de detecção (${v}), que já está dentro do limite ${lim}` }
        : { verdict: "indeterminate", reason: `resultado censurado e limite de detecção ${v} acima do limite legal ${lim}` };
    }
    return cmp(v <= lim, `valor ${v} ≤ limite ${lim}`, `valor ${v} > limite ${lim}`);
  }
  if (limit.limit_kind === "min") {
    const lim = Number(limit.limit_value);
    if (censored) {
      return { verdict: "indeterminate", reason: "resultado censurado não permite avaliar um limite mínimo" };
    }
    return cmp(v >= lim, `valor ${v} ≥ limite ${lim}`, `valor ${v} < limite ${lim}`);
  }
  if (limit.limit_kind === "range") {
    const lo = Number(limit.limit_lower);
    const hi = Number(limit.limit_upper);
    if (censored) {
      return { verdict: "indeterminate", reason: "resultado censurado não permite avaliar uma faixa" };
    }
    return cmp(v >= lo && v <= hi, `valor ${v} dentro de ${lo}–${hi}`, `valor ${v} fora de ${lo}–${hi}`);
  }
  return null;
}

await main();
