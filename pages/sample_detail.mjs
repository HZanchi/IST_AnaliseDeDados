import { escapeHtml, badge, table, layout, notice } from "../lib/html.mjs";
import {
  formatDateTime,
  formatNumber,
  matrixLabel,
  sampleStatusLabel,
  verdictLabel,
  verdictKind,
  limitPhrase,
  limitKindLabel,
} from "../lib/format.mjs";
import { stateBadge, lawBadges } from "./overview.mjs";

function resultCard(result) {
  const judges = result.judges.length
    ? `<ul class="judge-list">${result.judges
        .map((j) => {
          const pending = !j.verdict;
          return `<li class="judge ${pending ? "judge-pending" : `judge-${verdictKind(j.verdict)}`}">
            <span class="judge-law">${escapeHtml(j.law_short_name)}</span>
            <span class="judge-limit" title="${escapeHtml(limitKindLabel(j.limit_kind))}">${escapeHtml(limitPhrase(j))}</span>
            <span class="judge-verdict">${
              pending
                ? badge("warn", "Não avaliado")
                : badge(verdictKind(j.verdict), verdictLabel(j.verdict))
            }</span>
            <span class="judge-reason">${escapeHtml(j.reason || (pending ? "sem veredito registrado (regras oficiais em definição)" : ""))}</span>
            ${
              pending
                ? ""
                : `<span class="muted judge-meta">por ${escapeHtml(j.evaluated_by || "sistema")}${j.rule_version ? ` · regra ${escapeHtml(j.rule_version)}` : ""}</span>`
            }
          </li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">Nenhum limite carregado se aplica a este resultado (matriz ou data da coleta fora da vigência das leis cadastradas).</p>`;

  const pendingCount = result.judges.filter((j) => !j.verdict).length;
  const badCount = result.judges.filter((j) => j.verdict === "non_compliant").length;
  const okCount = result.judges.filter((j) => j.verdict === "compliant").length;

  return `<article class="result-card">
    <header>
      <div>
        <h3>${escapeHtml(result.parameter_name)}</h3>
        <p class="muted"><code>${escapeHtml(result.parameter_code)}</code> · ${escapeHtml(result.parameter_category)}${
          result.replicate > 1 ? ` · repetição ${result.replicate}` : ""
        }</p>
      </div>
      <div class="result-value">
        <span class="big">${escapeHtml(formatResultValue(result))}</span>
        <span class="unit">${escapeHtml(result.unit || result.parameter_unit || "")}</span>
      </div>
      <div class="result-tally">
        ${
          okCount
            ? badge("ok", `${okCount} conforme${okCount > 1 ? "s" : ""}`)
            : ""
        }
        ${
          badCount
            ? badge("bad", `${badCount} não conforme${badCount > 1 ? "s" : ""}`)
            : ""
        }
        ${pendingCount ? badge("warn", `${pendingCount} não avaliado${pendingCount > 1 ? "s" : ""}`) : ""}
        ${!result.judges.length ? badge("neutral", "sem limite") : ""}
      </div>
    </header>
    <p class="muted result-meta">
      ${escapeHtml(result.laboratory || "laboratório não informado")}
      · medida ${escapeHtml(formatDateTime(result.measured_at))}
      · laudo ${escapeHtml(formatDateTime(result.reported_at))}
      · status ${escapeHtml(result.data_status)}
      ${result.censored ? ` · censurado: ${escapeHtml(result.censored)}` : ""}
      ${result.detection_limit ? ` · LD ${escapeHtml(formatNumber(result.detection_limit))}` : ""}
    </p>
    ${judges}
  </article>`;
}

function formatResultValue(result) {
  if (result.value_numeric !== null && result.value_numeric !== undefined) {
    const prefix =
      result.censored === "below_dl"
        ? "< "
        : result.censored === "above_ul"
          ? "> "
          : result.censored === "not_detected"
            ? "ND "
            : "";
    return `${prefix}${formatNumber(result.value_numeric)}`;
  }
  return result.value_text || "—";
}

export function renderSampleDetail(detail, { demo = false } = {}) {
  if (!detail) return null;
  const { sample } = detail;

  const perLawChips = detail.perLaw.length
    ? `<ul class="chips">${detail.perLaw
        .map((row) => {
          const counts = Number(row.verdict_count)
            ? ` <span class="muted">${Number(row.compliant_count)}/${Number(row.verdict_count)} conformes</span>`
            : row.sample_verdict === "no_limit"
              ? ` <span class="muted">nenhum limite desta lei cobre esta matriz/data</span>`
              : ` <span class="muted">${Number(row.covering_limits ?? 0)} limite(s) aplicável(eis), nenhum veredito</span>`;
          return `<li>${escapeHtml(row.legislation_short_name)} — ${badge(
            verdictKind(row.sample_verdict),
            verdictLabel(row.sample_verdict),
          )}${counts}</li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">Nenhum veredito registrado para esta amostra.</p>`;

  const coverageLine = `${detail.result_count} resultado(s) · ${detail.applicable_limits} limite(s) aplicável(eis) · ${detail.judged_limits} já julgado(s)`;

  const body = `
<section>
  <div class="hero ${detail.state === "non_compliant" ? "hero-bad" : detail.state === "compliant" ? "hero-ok" : "hero-warn"}">
    <div class="hero-mark">${detail.state === "compliant" ? "✓" : detail.state === "non_compliant" ? "✕" : "i"}</div>
    <div>
      <h1><code>${escapeHtml(sample.code)}</code> ${stateBadge(detail.state)}</h1>
      <p>
        ${escapeHtml(sample.point_name)} (<code>${escapeHtml(sample.point_code)}</code>)
        · coletada em <strong>${formatDateTime(sample.collected_at)}</strong>
        · ${escapeHtml(matrixLabel(sample.matrix))}
        · status ${escapeHtml(sampleStatusLabel(sample.status))}
      </p>
      <p class="muted">${escapeHtml(coverageLine)}${
        sample.region ? ` · ${escapeHtml(sample.region)}` : ""
      }${sample.water_body ? ` · ${escapeHtml(sample.water_body)}` : ""}${
        sample.collected_by ? ` · coletada por ${escapeHtml(sample.collected_by)}` : ""
      }${sample.field_notes ? ` · observações: ${escapeHtml(sample.field_notes)}` : ""}</p>
    </div>
  </div>
  ${demo ? notice({ tone: "warn", title: "Amostra de demonstração.", body: "Inserida por <code>npm run demo:seed</code> para ilustrar o dashboard; remova com <code>npm run demo:purge</code>." }) : ""}
  <p class="no-print"><a class="btn btn-primary" href="/amostras/${encodeURIComponent(sample.code)}/relatorio">Emitir relatório de ensaio</a></p>
</section>

<section>
  <h2>Conformidade por legislação</h2>
  ${perLawChips}
  ${
    detail.state === "no_limit"
      ? notice({
          tone: "warn",
          title: "Sem limite aplicável.",
          body: "Nenhuma lei carregada cobre esta matriz/data — as leis atuais (CONAMA 357/2005) valem para <strong>água superficial</strong>. A regra de matriz do esquema impede a comparação por segurança.",
        })
      : ""
  }
  ${
    detail.state === "not_evaluated"
      ? notice({
          tone: "warn",
          title: "Limites aplicáveis ainda não avaliados.",
          body: "Existem leis que cobrem esta amostra, mas nenhum veredito foi gravado. As regras oficiais de veredito ainda não foram aplicadas (tarefa própria do projeto de dados); o que aparece aqui vem do que já está em <code>compliance_verdicts</code>.",
        })
      : ""
  }
</section>

<section>
  <h2>Resultados (${detail.results.length})</h2>
  ${detail.results.map(resultCard).join("") || `<div class="empty">Nenhum resultado para esta amostra.</div>`}
</section>

<section>
  <h2>Registro bruto</h2>
  ${table({
    head: ["Campo", "Valor"],
    empty: "—",
    rows: [
      ["Recebida em", formatDateTime(sample.received_at)],
      ["Profundidade (m)", formatNumber(sample.depth_m)],
      ["Temperatura (°C)", formatNumber(sample.temperature_c)],
      ["Endereço", sample.address || "—"],
      ["Metadados", `<code>${escapeHtml(JSON.stringify(sample.metadata || {}))}</code>`],
    ],
  })}
</section>

<p><a href="/amostras">← Voltar para as amostras</a></p>`;

  return layout({
    title: `Projeto IST — amostra ${sample.code}`,
    active: "samples",
    body,
  });
}
