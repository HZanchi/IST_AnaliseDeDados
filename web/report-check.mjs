/**
 * Verificação do gerador de relatório (PRO-19) contra os dados reais do
 * demo — PRO-5 §3.2 / "How to verify".
 *
 *   npm run report:check
 *
 * Sai com 1 se alguma asserção falhar. Não escreve no banco (só leitura).
 */
import { buildSampleReport, ReportError } from "./lib/report.mjs";
import { renderReport } from "./pages/report.mjs";
import { closePool } from "./lib/db.mjs";

/** §2.9 — smoke vivo (2026-10-21): razão OMS nas quatro amostras de consumo. */
const WHO_RATIO_SMOKE = ["0,5831", "0,7134", "0,8041", "0,8635"];

let failures = 0;
let checks = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n${title}`);
}

/** Texto visível da página (sem tags) — é o que o leitor do relatório copia. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

/** Todas as linhas da célula (parâmetro × lei) — §4: a célula é uma lista. */
function cellLines(report, parameterCode, lawCode) {
  const row = report.comparison.find(
    (r) => r.result.parameter_code === parameterCode,
  );
  return (
    row?.cells.find((c) => c.column.law.code === lawCode)?.lines ?? []
  );
}

/** Primeira linha da célula (parâmetro × lei) da tabela comparativa (§4.1). */
function cellLine(report, parameterCode, lawCode) {
  return cellLines(report, parameterCode, lawCode)[0];
}

async function main() {
  /* ---- §3.2 exemplo trabalhado: DEMO-2026-010 (superficial, CONAMA) ---- */
  section("DEMO-2026-010 (água superficial, lei padrão CONAMA)");
  const surface = await buildSampleReport("DEMO-2026-010");
  check("relatório montado", Boolean(surface));
  check(
    "ID REL-<código>-<AAAAMMDD-HHmm>",
    /^REL-DEMO-2026-010-\d{8}-\d{4}$/.test(surface.reportId),
    surface.reportId,
  );
  check("lei vinculante CONAMA", surface.target?.code === "CONAMA-357-2005");
  check(
    "conclusão geral Não conforme (§5.2)",
    surface.overall?.state === "non_compliant",
    surface.overall?.state,
  );
  check(
    "cobertura 11 de 11 (§3.2)",
    surface.overall?.coverage.covered === 11 &&
      surface.overall?.coverage.total === 11,
    JSON.stringify(surface.overall?.coverage),
  );
  check("11 linhas de resultado (§3.1)", surface.resultRows.length === 11, String(surface.resultRows.length));
  check(
    "todas as linhas são CONAMA (matriz surface)",
    surface.resultRows.every((r) => r.limit?.legislation_code === "CONAMA-357-2005"),
  );
  const conama = surface.perLaw.find((r) => r.law.code === "CONAMA-357-2005");
  check("9 conformes (§3.2)", conama?.counts?.compliant_count === 9, JSON.stringify(conama?.counts));
  check("2 não conformes (§3.2)", conama?.counts?.non_compliant_count === 2, JSON.stringify(conama?.counts));
  check("0 indeterminados (§3.2)", conama?.counts?.indeterminate_count === 0, JSON.stringify(conama?.counts));
  check("veredito por lei Não conforme", conama?.state === "non_compliant", conama?.state);
  const others = surface.perLaw.filter((r) => r.law.code !== "CONAMA-357-2005");
  check(
    "WHO/UE/EPA leem Sem limite aplicável com escopo `tap` (§3.2)",
    others.every((r) => r.state === "no_limit" && r.hint === "limite `tap`"),
    JSON.stringify(others.map((r) => [r.law.code, r.state, r.hint])),
  );
  check(
    "nenhuma linha julgada sem citação (§3)",
    surface.citations.every(
      (c) =>
        (c.kind === "limit"
          ? c.limit.citation && c.limit.document_reference
          : c.composite.citation && c.composite.document_reference),
    ),
  );
  const arsenic = surface.citations.find(
    (c) => c.kind === "limit" && c.limit.parameter_code === "arsenic",
  );
  check(
    "camada 1 CONAMA arsênio (§6.1)",
    arsenic?.layer1.includes(
      "CONAMA 357/2005 (Brazil), parâmetro: Arsenic (total) (arsenic), matriz: Água superficial",
    ),
    arsenic?.layer1,
  );
  check(
    "vigência pela publicação (§6)",
    arsenic?.layer1.includes("vigência: publicada em 17/03/2005 (vigência não registrada)"),
    arsenic?.layer1,
  );
  check(
    "camada 2 verbatim + método do catálogo (§6)",
    arsenic?.layer2.startsWith("Res. CONAMA nº 357/2005, art. 14") &&
      arsenic?.layer2.includes("método: Hydride generation AAS / SM 3113 B"),
    arsenic?.layer2,
  );

  /* ---- §4.1 células de exemplo (superficial) ---- */
  const sNitrate = cellLine(surface, "nitrate_as_n", "CONAMA-357-2005");
  check(
    "§4.1 CONAMA/nitrato: publicado → normalizado, tier e base visíveis",
    sNitrate?.text ===
      "10 mg/L N → 10 mg/L as N · Limite máximo/amostra individual" &&
      sNitrate?.state === "non_compliant",
    JSON.stringify(sNitrate),
  );
  const sWho = cellLine(surface, "nitrate_as_n", "WHO-GDWQ");
  check(
    "§4.1 OMS/nitrato numa amostra superficial: Sem limite aplicável (limite `tap`)",
    sWho?.kind === "no_limit" &&
      sWho?.text === "Sem limite aplicável (limite `tap`)",
    JSON.stringify(sWho),
  );

  /* ---- renderização ---- */
  const surfaceHtml = renderReport(surface);
  const surfaceText = visibleText(surfaceHtml);
  for (const needle of [
    "RELATÓRIO DE ENSAIO",
    "1. Resumo de veredito",
    "2. Resultados",
    "3. Comparativo entre legislações",
    "4. Legenda",
    "5. Citações",
    "6. Responsável técnico",
    "Sem limite aplicável",
    "Não avaliado",
    "Indeterminado",
    "DADOS DE DEMONSTRAÇÃO",
    "11 de 11 resultados com limite aplicável (CONAMA 357/2005)",
    "Não conforme (CONAMA 357/2005)",
  ]) {
    check(`HTML contém "${needle}"`, surfaceText.includes(needle));
  }

  /* ---- amostra de água de consumo: pendente + Sem limite aplicável ---- */
  section("DEMO-2026-003 (água tratada, lei padrão CONAMA)");
  const tap = await buildSampleReport("DEMO-2026-003");
  check("relatório montado", Boolean(tap));
  check(
    "conclusão geral Sem limite aplicável (0 de 11, §5.2)",
    tap.overall?.state === "no_limit" &&
      tap.overall?.coverage.covered === 0 &&
      tap.overall?.coverage.total === 11,
    JSON.stringify(tap.overall),
  );
  const conamaTap = tap.perLaw.find((r) => r.law.code === "CONAMA-357-2005");
  check(
    "linha CONAMA Sem limite aplicável (limite `surface`)",
    conamaTap?.state === "no_limit" && conamaTap?.hint === "limite `surface`",
    JSON.stringify(conamaTap),
  );
  check(
    "oxigênio dissolvido sem limite algum (§3.2)",
    tap.resultRows.some(
      (r) => r.result.parameter_code === "dissolved_oxygen" && r.state === "no_limit",
    ),
  );
  check(
    "pendente aparece em nitrato EU/WHO (§1)",
    tap.resultRows.some(
      (r) =>
        r.result.parameter_code === "nitrate_as_n" &&
        r.limit?.conversion_status === "ambiguous",
    ),
  );
  check(
    "limite ambíguo é Indeterminado, nunca Conforme (§1)",
    tap.resultRows
      .filter((r) => r.limit?.conversion_status === "ambiguous")
      .every((r) => r.state === "indeterminate"),
  );

  /* ---- §4.1 células de exemplo (água de consumo) ---- */
  const tConama = cellLine(tap, "nitrate_as_n", "CONAMA-357-2005");
  check(
    "§4.1 CONAMA/nitrato em amostra tratada: Sem limite aplicável (limite `surface`)",
    tConama?.kind === "no_limit" &&
      tConama?.text === "Sem limite aplicável (limite `surface`)",
    JSON.stringify(tConama),
  );
  const tWho = cellLine(tap, "nitrate_as_n", "WHO-GDWQ");
  check(
    "§4.1 OMS/nitrato: publicado + pendente + diretriz → Indeterminado",
    tWho?.text ===
      "50 mg/L (as NO3−) · pendente · Diretriz/amostra individual" &&
      tWho?.state === "indeterminate",
    JSON.stringify(tWho),
  );
  const tEu = cellLine(tap, "nitrate_as_n", "EU-2020-2184");
  check(
    "§4.1 UE/nitrato: publicado + pendente + limite máximo → Indeterminado",
    tEu?.text ===
      "50 mg/l (as NO3−) · pendente · Limite máximo/amostra individual" &&
      tEu?.state === "indeterminate",
    JSON.stringify(tEu),
  );
  const tEpa = cellLine(tap, "nitrate_as_n", "EPA-NPDWR");
  check(
    "§4.1 EPA/nitrato: forma publicada e normalizada idênticas → sem seta",
    tEpa?.text === "10 mg/L as N · Limite máximo/amostra individual" &&
      tEpa?.state === "compliant",
    JSON.stringify(tEpa),
  );
  const tFluoride = cellLines(tap, "fluoride", "EPA-NPDWR");
  check(
    "§4 célula EPA/flúorido lista os 2 limites (nível máximo + estético)",
    tFluoride.length === 2 &&
      tFluoride.some((l) => l.text.includes("Limite máximo")) &&
      tFluoride.some((l) => l.text.includes("Estético")),
    JSON.stringify(tFluoride),
  );
  const tapHtml = renderReport(tap);
  check("HTML marca pendente", tapHtml.includes("pendente"));
  check("HTML cita limite `surface` da CONAMA", tapHtml.includes("limite `surface`"));

  /* ---- §2.9 regras compostas avaliadas (não "não modelado") ---- */
  check(
    "2 regras aplicáveis na amostra de consumo",
    tap.composites.length === 2,
    JSON.stringify(tap.composites.map((c) => c.rule_code)),
  );
  const whoRule = tap.composites.find(
    (c) => c.rule_code === "who_nitrate_nitrite_ratio",
  );
  check(
    "OMS razão (NO3/50)+(NO2/3) → Conforme com o valor da expressão (§2.9)",
    whoRule?.evaluation?.state === "compliant" &&
      Boolean(whoRule?.evaluation?.valueLabel),
    JSON.stringify(whoRule?.evaluation),
  );
  check(
    "valor da expressão do smoke do spec (§2.9)",
    WHO_RATIO_SMOKE.includes(whoRule?.evaluation?.valueLabel),
    whoRule?.evaluation?.valueLabel,
  );
  const euRule = tap.composites.find((c) => c.rule_code === "eu_pce_tce_sum");
  check(
    "UE soma PCE+TCE sem medidas → Indeterminado nomeando as entradas (§2.9)",
    euRule?.evaluation?.state === "indeterminate" &&
      euRule.evaluation.reason.includes("tetrachloroethene") &&
      euRule.evaluation.reason.includes("trichloroethene"),
    JSON.stringify(euRule?.evaluation),
  );
  check(
    "uma linha Regra composta por regra, depois das linhas por resultado (§3.1)",
    tap.resultRows.filter((r) => r.composite).length === 2 &&
      // 25 limites aplicáveis + 1 resultado sem limite (DO) + 2 regras compostas
    tap.resultRows.length === 25 + 1 + 2,
    `total=${tap.resultRows.length} compostas=${tap.resultRows.filter((r) => r.composite).length}`,
  );
  check(
    "citação da regra: camada 1 composta + camada 2 verbatim (§6)",
    tap.citations.some(
      (c) =>
        c.kind === "composite" &&
        c.layer1.includes("regra: who_nitrate_nitrite_ratio") &&
        c.layer2.startsWith("WHO GDWQ 4ª ed."),
    ),
    JSON.stringify(
      tap.citations.filter((c) => c.kind === "composite").map((c) => c.layer1),
    ),
  );
  check(
    "§7 item 7: o rótulo aposentado \"não modelado\" não aparece",
    !tapHtml.includes("não modelado"),
  );
  check(
    "bloco Regra composta depois da tabela comparativa (§4)",
    tapHtml.includes("Regras compostas") &&
      tapHtml.includes("(NO3/50)+(NO2/3) &lt;= 1"),
    String(tapHtml.includes("(NO3/50)+(NO2/3)")),
  );

  /* ---- §5.2 a escada da lei escolhida ---- */
  const whoReport = await buildSampleReport("DEMO-2026-003", { target: "WHO-GDWQ" });
  check(
    "OMS como lei de referência → Não conforme (turbidez 22 NTU > 1 NTU)",
    whoReport?.overall?.state === "non_compliant",
    JSON.stringify(whoReport?.overall),
  );
  check(
    "cobertura conta resultados, não regras compostas (§2.9)",
    whoReport?.overall?.coverage.total === 11 &&
      whoReport?.overall?.coverage.covered === 5,
    JSON.stringify(whoReport?.overall?.coverage),
  );
  // §3.2 — oxigênio dissolvido na água tratada não tem limite em lei alguma;
  // a CONAMA só é afetada por escopo de matriz, as outras simplesmente não
  // têm o parâmetro (nenhuma delas pode alegar escopo errado).
  const doCells = tap.comparison
    .filter(({ result }) => result.parameter_code === "dissolved_oxygen")
    .flatMap(({ cells }) => cells);
  check(
    "oxigênio dissolvido: 4 células, todas Sem limite aplicável",
    doCells.length === 4 &&
      doCells.every((c) => c.lines.every((l) => l.kind === "no_limit")),
    JSON.stringify(doCells.map((c) => [c.column.law.code, c.lines])),
  );
  const doConama = doCells.find((c) => c.column.law.code === "CONAMA-357-2005");
  check(
    "DO na CONAMA aponta o escopo `surface`",
    Boolean(doConama?.lines[0]?.text.includes("limite `surface`")),
    doConama?.lines[0]?.text,
  );
  const doEpa = doCells.find((c) => c.column.law.code === "EPA-NPDWR");
  check(
    "DO na EPA não inventa escopo (a lei cobre `tap`, só não mede o parâmetro)",
    doEpa?.lines[0]?.text === "Sem limite aplicável",
    doEpa?.lines[0]?.text,
  );

  /* ---- §5.2 sem lei vinculante → sem conclusão geral ---- */
  section("DEMO-2026-010 sem lei vinculante (?lei=nenhuma)");
  const noTarget = await buildSampleReport("DEMO-2026-010", { target: null });
  check("sem conclusão geral", noTarget.overall === null, JSON.stringify(noTarget.overall));
  check(
    "colunas sem marcador principal/referência",
    noTarget.columns.every((c) => c.isTarget === false),
  );
  const noTargetHtml = renderReport(noTarget);
  check("HTML explica a ausência de conclusão", noTargetHtml.includes("sem conclusão geral"));
  check(
    "nenhum rótulo geral com nome de lei",
    !noTargetHtml.includes("Geral:"),
  );

  /* ---- lei inválida é recusada ---- */
  section("Entradas inválidas");
  let rejected = false;
  try {
    await buildSampleReport("DEMO-2026-010", { target: "LEI-INEXISTENTE" });
  } catch (err) {
    rejected = err instanceof ReportError && err.status === 400;
    check("erro ReportError 400", rejected, `${err.name}:${err.status}`);
  }
  check("lei desconhecida recusada", rejected);

  const missing = await buildSampleReport("NAO-EXISTE");
  check("amostra inexistente devolve null", missing === null);

  console.log(`\n${checks - failures}/${checks} verificações OK`);
  if (failures) {
    console.error(`${failures} falha(s)`);
  }
  return failures ? 1 : 0;
}

const code = await main().catch((err) => {
  console.error("erro:", err);
  return 1;
});
await closePool();
process.exit(code);
