import { escapeHtml, badge, table, layout, notice } from "../lib/html.mjs";
import {
  formatDateTime,
  formatNumber,
  matrixLabel,
  verdictLabel,
  verdictKind,
  limitPhrase,
} from "../lib/format.mjs";
import { timeChart } from "../lib/chart.mjs";

function parameterForm(catalog, selected) {
  const options = catalog
    .map(
      (p) =>
        `<option value="${escapeHtml(p.code)}" ${p.code === selected ? "selected" : ""}>${escapeHtml(p.name)} (${escapeHtml(p.unit || "s/un")})${p.result_count ? ` — ${p.result_count} resultado(s)` : ""}</option>`,
    )
    .join("");
  if (!catalog.length) return "";
  return `<form class="filters" method="get" action="/resultados">
    <label>Parâmetro
      <select name="param">${options}</select>
    </label>
    <button type="submit">Traçar</button>
  </form>`;
}

function thresholdsFromLimits(limits) {
  const out = [];
  for (const ll of limits) {
    const scope = ll.applies_to_matrix ? ` · ${matrixLabel(ll.applies_to_matrix)}` : "";
    if (ll.limit_kind === "max") {
      out.push({
        y: Number(ll.limit_value),
        kind: "max",
        label: `máx ${formatNumber(ll.limit_value)} ${ll.unit || ""} · ${ll.law_short_name}${scope}`,
      });
    } else if (ll.limit_kind === "min") {
      out.push({
        y: Number(ll.limit_value),
        kind: "min",
        label: `mín ${formatNumber(ll.limit_value)} ${ll.unit || ""} · ${ll.law_short_name}${scope}`,
      });
    } else if (ll.limit_kind === "range") {
      out.push({
        y: Number(ll.limit_upper),
        kind: "max",
        label: `máx ${formatNumber(ll.limit_upper)} ${ll.unit || ""} · ${ll.law_short_name}${scope}`,
      });
      out.push({
        y: Number(ll.limit_lower),
        kind: "min",
        label: `mín ${formatNumber(ll.limit_lower)} ${ll.unit || ""} · ${ll.law_short_name}${scope}`,
      });
    }
  }
  return out;
}

export function renderTimeline({ timeline, catalog, selectedCode }) {
  const { parameter, results, limits, verdicts } = timeline;

  const numeric = results.filter(
    (r) => r.value_numeric !== null && r.value_numeric !== undefined,
  );
  const thresholds = thresholdsFromLimits(limits);
  const chart = numeric.length
    ? timeChart({
        points: numeric.map((r) => ({
          t: r.collected_at,
          y: Number(r.value_numeric),
          label: `${r.sample_code} · ${formatDateTime(r.collected_at)} · ${formatNumber(r.value_numeric)} ${r.unit || parameter.unit || ""} · ${r.point_name}`,
        })),
        thresholds,
        yUnit: parameter.unit || "",
      })
    : "";

  const limitLegend = limits.length
    ? `<ul class="chips">${limits
        .map(
          (ll) =>
            `<li>${escapeHtml(ll.law_short_name)} — ${escapeHtml(limitPhrase(ll))}${
              ll.applies_to_matrix ? ` <span class="muted">(${escapeHtml(matrixLabel(ll.applies_to_matrix))})</span>` : ""
            }</li>`,
        )
        .join("")}</ul>`
    : `<p class="muted">Nenhum limite carregado para este parâmetro.</p>`;

  const verdictBySampleLaw = new Map(
    verdicts.map((v) => [`${v.sample_code}|${v.law_code}`, v]),
  );

  const body = `
<section>
  <h2>Resultados ao longo do tempo</h2>
  <p class="muted">Série temporal de um parâmetro com as linhas de limite das legislações carregadas. Passe o mouse sobre um ponto para ver a amostra.</p>
  ${parameterForm(catalog, selectedCode)}
</section>

<section>
  <h3>${escapeHtml(parameter.name)} <span class="muted">· ${escapeHtml(parameter.category)} · ${escapeHtml(parameter.unit || "sem unidade")}</span></h3>
  ${
    chart
      ? `<div class="chart-wrap">${chart}</div>`
      : notice({
          tone: "warn",
          title: "Sem valores numéricos para traçar.",
          body: "Este parâmetro ainda não tem resultados no banco. Carregue dados (<code>npm run demo:seed</code>) ou cadastre ensaios pela interface de CRUD.",
        })
  }
  <p class="muted">Limites de referência:</p>
  ${limitLegend}
</section>

<section>
  <h2>Valores medidos (${results.length})</h2>
  ${table({
    head: ["Amostra", "Coleta", "Ponto", "Matriz", "Valor", "Veredito"],
    empty: "Nenhum resultado para este parâmetro.",
    rows: results.map((r) => {
      const lawChips = limits
        .map((ll) => {
          const v = verdictBySampleLaw.get(`${r.sample_code}|${ll.law_code}`);
          if (!v) return "";
          return `<span class="law-chip">${escapeHtml(ll.law_short_name)} ${badge(verdictKind(v.verdict), verdictLabel(v.verdict))}</span>`;
        })
        .filter(Boolean)
        .join(" ");
      return [
        `<a href="/amostras/${encodeURIComponent(r.sample_code)}"><code>${escapeHtml(r.sample_code)}</code></a>`,
        formatDateTime(r.collected_at),
        escapeHtml(r.point_name),
        matrixLabel(r.matrix),
        `<strong>${formatNumber(r.value_numeric)}</strong> <span class="unit">${escapeHtml(r.unit || parameter.unit || "")}</span>${r.censored ? ` <span class="muted">(${escapeHtml(r.censored)})</span>` : ""}`,
        lawChips || `<span class="muted">—</span>`,
      ];
    }),
  })}
</section>

<p><a href="/comparativo?param=${encodeURIComponent(selectedCode)}">Ver este parâmetro em todas as legislações →</a></p>`;

  return layout({
    title: `Projeto IST — ${parameter.name} no tempo`,
    active: "timeline",
    body,
  });
}
