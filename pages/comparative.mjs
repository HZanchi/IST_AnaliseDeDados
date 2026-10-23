import { escapeHtml, badge, table, layout, notice } from "../lib/html.mjs";
import {
  formatDateTime,
  formatNumber,
  matrixLabel,
  verdictLabel,
  verdictKind,
  limitKindLabel,
  limitTierLabel,
  basisLabel,
  conversionLabel,
  canonicalMissing,
} from "../lib/format.mjs";

function parameterForm(catalog, selected) {
  if (!catalog.length) return "";
  const options = catalog
    .map(
      (p) =>
        `<option value="${escapeHtml(p.code)}" ${p.code === selected ? "selected" : ""}>${escapeHtml(p.name)}</option>`,
    )
    .join("");
  return `<form class="filters" method="get" action="/comparativo">
    <label>Parâmetro
      <select name="param">${options}</select>
    </label>
    <button type="submit">Comparar</button>
  </form>`;
}

function conversionChip(limit) {
  const status = limit.conversion_status || "exact";
  const tone =
    status === "ambiguous" ? "bad" : status === "converted" ? "warn" : "ok";
  const chip = badge(tone, conversionLabel(status));
  const note = limit.conversion_note
    ? `<div class="muted small">${escapeHtml(limit.conversion_note)}</div>`
    : "";
  return chip + note;
}

export function renderComparative({ comparative, catalog, selectedCode }) {
  const { parameter, limits, results, verdicts } = comparative;

  const verdictKey = new Map(
    verdicts.map((v) => [`${v.sample_code}|${v.law_code}`, v]),
  );

  const meta = table({
    head: ["Campo", "Valor"],
    empty: "—",
    rows: [
      ["Código", `<code>${escapeHtml(parameter.code)}</code>`],
      ["Categoria", escapeHtml(parameter.category)],
      ["Tipo", escapeHtml(parameter.data_type)],
      ["Unidade canônica", escapeHtml(parameter.unit || "—")],
      ["Limite de detecção", escapeHtml(formatNumber(parameter.detection_limit))],
      [
        "Faixa ideal (informativa)",
        parameter.ideal_range_lower !== null && parameter.ideal_range_lower !== undefined
          ? `${formatNumber(parameter.ideal_range_lower)} – ${formatNumber(parameter.ideal_range_upper)} ${escapeHtml(parameter.unit || "")}`
          : "—",
      ],
      ["Sínimos", parameter.synonyms?.length ? parameter.synonyms.map(escapeHtml).join(", ") : "—"],
      ["Descrição", parameter.description ? escapeHtml(parameter.description) : "—"],
      ["Método", parameter.method_reference ? escapeHtml(parameter.method_reference) : "—"],
    ],
  });

  const limitsBlock = limits.length
    ? table({
        head: [
          "Legislação",
          "Valor publicado (como a lei escreve)",
          "Valor normalizado (para comparação)",
          "Abrangência",
          "Tipo",
          "Conversão",
          "Citação",
        ],
        empty: "Nenhum limite carregado.",
        rows: limits.map((ll) => {
          const published =
            ll.limit_kind === "text"
              ? escapeHtml(ll.limit_text || "—")
              : `<strong>${escapeHtml(publishedPhrase(ll))}</strong>`;
          const canonical =
            ll.limit_kind === "text"
              ? escapeHtml(ll.limit_text || "—")
              : canonicalMissing(ll)
                ? `${badge("warn", "pendente")}<br><span class="muted small">valor canônico nulo — conversão ambígua, exige conferência humana</span>`
                : `<strong>${escapeHtml(canonicalPhrase(ll))}</strong>`;
          return [
            `${escapeHtml(ll.law_short_name)}<br><span class="muted">${escapeHtml(ll.issuing_body)}</span>`,
            published,
            canonical,
            `${ll.applies_to_matrix === "any" ? badge("neutral", "todas as matrizes") : escapeHtml(matrixLabel(ll.applies_to_matrix))}<br><span class="muted">${escapeHtml(limitTierLabel(ll.limit_tier))} · ${escapeHtml(basisLabel(ll.basis))}</span>`,
            escapeHtml(limitKindLabel(ll.limit_kind)),
            conversionChip(ll),
            escapeHtml(ll.citation || "—"),
          ];
        }),
      })
    : `<div class="empty">Este parâmetro ainda não tem limite em nenhuma legislação carregada.</div>`;

  const resultsBlock = results.length
    ? table({
        head: ["Amostra", "Coleta", "Ponto", "Valor", "Vereditos por legislação"],
        empty: "Sem resultados.",
        rows: results.map((r) => {
          const chips = limits
            .map((ll) => {
              const v = verdictKey.get(`${r.sample_code}|${ll.law_code}`);
              if (!v) return "";
              return `<span class="law-chip">${escapeHtml(ll.law_short_name)} ${badge(verdictKind(v.verdict), verdictLabel(v.verdict))}</span>`;
            })
            .filter(Boolean)
            .join(" ");
          return [
            `<a href="/amostras/${encodeURIComponent(r.sample_code)}"><code>${escapeHtml(r.sample_code)}</code></a>`,
            formatDateTime(r.collected_at),
            escapeHtml(r.point_name),
            `<strong>${formatNumber(r.value_numeric)}</strong> <span class="unit">${escapeHtml(r.unit || parameter.unit || "")}</span>`,
            chips || `<span class="muted">sem veredito</span>`,
          ];
        }),
      })
    : `<div class="empty">Nenhum resultado medido para este parâmetro ainda.</div>`;

  const body = `
<section>
  <h2>Parâmetro × legislação</h2>
  <p class="muted">O mesmo parâmetro comparado às leis carregadas: o valor <strong>publicado</strong> é o que o texto da lei cita (relatórios citam assim); o valor <strong>normalizado</strong> é o que o banco usa para comparar com o resultado medido — decisão aprovada do esquema.</p>
  ${parameterForm(catalog, selectedCode)}
</section>

<section>
  <h3>${escapeHtml(parameter.name)}</h3>
  ${meta}
</section>

<section>
  <h2>Limites por legislação (${limits.length})</h2>
  ${limitsBlock}
</section>

<section>
  <h2>Resultados medidos (${results.length})</h2>
  ${resultsBlock}
</section>

${
  results.length && !verdicts.length
    ? notice({
        tone: "warn",
        title: "Resultados sem veredito.",
        body: "Há valores medidos, mas nenhum veredito gravado em <code>compliance_verdicts</code> para este parâmetro.",
      })
    : ""
}

<p><a href="/limites?param=${encodeURIComponent(selectedCode)}">Ver esta lista na visão de limites →</a> · <a href="/resultados?param=${encodeURIComponent(selectedCode)}">Ver a série temporal →</a></p>`;

  return layout({
    title: `Projeto IST — ${parameter.name} × legislação`,
    active: "comparative",
    body,
  });
}

function publishedPhrase(ll) {
  const unit = ll.published_unit ? ` ${ll.published_unit}` : "";
  if (ll.limit_kind === "max") return `≤ ${formatNumber(ll.published_value)}${unit}`;
  if (ll.limit_kind === "min") return `≥ ${formatNumber(ll.published_value)}${unit}`;
  if (ll.limit_kind === "range") {
    return `${formatNumber(ll.published_lower)} – ${formatNumber(ll.published_upper)}${unit}`;
  }
  return ll.limit_text || "—";
}

function canonicalPhrase(ll) {
  const unit = ll.unit ? ` ${ll.unit}` : "";
  if (ll.limit_kind === "max") return `≤ ${formatNumber(ll.limit_value)}${unit}`;
  if (ll.limit_kind === "min") return `≥ ${formatNumber(ll.limit_value)}${unit}`;
  if (ll.limit_kind === "range") {
    return `${formatNumber(ll.limit_lower)} – ${formatNumber(ll.limit_upper)}${unit}`;
  }
  return ll.limit_text || "—";
}
