import { escapeHtml, badge, table, layout, statsGrid } from "../lib/html.mjs";
import {
  formatNumber,
  formatDateTime,
  matrixLabel,
  limitKindLabel,
  limitTierLabel,
  basisLabel,
  conversionLabel,
  canonicalMissing,
} from "../lib/format.mjs";

function lawForm(laws, selected) {
  const options = [`<option value="">Todas as legislações</option>`]
    .concat(
      laws.map(
        (l) =>
          `<option value="${escapeHtml(l.code)}" ${l.code === selected ? "selected" : ""}>${escapeHtml(l.short_name)} (${l.limit_count})</option>`,
      ),
    )
    .join("");
  if (!laws.length) return "";
  return `<form class="filters" method="get" action="/limites">
    <label>Legislação
      <select name="lei">${options}</select>
    </label>
    <button type="submit">Filtrar</button>
    <a class="button-link" href="/limites">Limpar</a>
  </form>`;
}

function canonical(ll) {
  const unit = ll.unit ? ` ${ll.unit}` : "";
  if (ll.limit_kind === "max") return `≤ ${formatNumber(ll.limit_value)}${unit}`;
  if (ll.limit_kind === "min") return `≥ ${formatNumber(ll.limit_value)}${unit}`;
  if (ll.limit_kind === "range") {
    return `${formatNumber(ll.limit_lower)} – ${formatNumber(ll.limit_upper)}${unit}`;
  }
  return ll.limit_text || "—";
}

function published(ll) {
  const unit = ll.published_unit ? ` ${ll.published_unit}` : "";
  if (ll.limit_kind === "max") return `≤ ${formatNumber(ll.published_value)}${unit}`;
  if (ll.limit_kind === "min") return `≥ ${formatNumber(ll.published_value)}${unit}`;
  if (ll.limit_kind === "range") {
    return `${formatNumber(ll.published_lower)} – ${formatNumber(ll.published_upper)}${unit}`;
  }
  return ll.limit_text || "—";
}

export function renderLimits({ rows, statsByLaw, laws, selectedLaw, selectedParam }) {
  const lawStats = laws.map((l) => {
    const s = statsByLaw[l.code] || {};
    return {
      value: formatNumber(s.total ?? 0, { maxDigits: 0 }),
      label: l.short_name,
      hint: `${s.max_count ?? 0} máx · ${s.min_count ?? 0} mín · ${s.range_count ?? 0} faixa${s.converted_count ? ` · ${s.converted_count} com conversão` : ""}`,
    };
  });

  const body = `
<section>
  <h2>Limites por legislação</h2>
  <p class="muted">Cada linha é uma regra de <code>legislation_limits</code>. <strong>Publicado</strong> = como a lei cita o valor (unidade e base originais). <strong>Normalizado</strong> = unidade canônica do parâmetro, usada na comparação com o resultado medido. Diferenças entre os dois ficam registradas com o estado de conversão — nunca são silenciosamente reescritas.</p>
  ${lawForm(laws, selectedLaw)}
</section>

<section>
  <h2>Volume por lei</h2>
  ${statsGrid(lawStats)}
</section>

<section>
  <h2>Regras (${rows.length})</h2>
  ${table({
    head: [
      "Legislação",
      "Parâmetro",
      "Tipo",
      "Publicado",
      "Normalizado",
      "Abrangência",
      "Conversão",
      "Citação",
    ],
    empty: "Nenhum limite para este filtro.",
    rows: rows.map((ll) => [
      `${escapeHtml(ll.law_short_name)}<br><span class="muted">${escapeHtml(ll.issuing_body)}</span>`,
      `<a href="/comparativo?param=${encodeURIComponent(ll.parameter_code)}">${escapeHtml(ll.parameter_name)}</a><br><span class="muted">${escapeHtml(ll.parameter_code)} · ${escapeHtml(ll.parameter_unit || "—")}</span>`,
      escapeHtml(limitKindLabel(ll.limit_kind)),
      `<span class="muted">${escapeHtml(published(ll))}</span>`,
      canonicalMissing(ll)
        ? `${badge("warn", "pendente")}<br><span class="muted small">valor canônico nulo — conversão ambígua</span>`
        : `<strong>${escapeHtml(canonical(ll))}</strong>`,
      `${ll.applies_to_matrix === "any" ? badge("neutral", "todas as matrizes") : escapeHtml(matrixLabel(ll.applies_to_matrix))}<br><span class="muted">${escapeHtml(limitTierLabel(ll.limit_tier))} · ${escapeHtml(basisLabel(ll.basis))}${ll.effective_from ? ` · vig. desde ${formatDateTime(ll.effective_from).slice(0, 10)}` : ""}</span>`,
      badge(
        ll.conversion_status === "ambiguous"
          ? "bad"
          : ll.conversion_status === "converted"
            ? "warn"
            : "ok",
        conversionLabel(ll.conversion_status),
      ),
      escapeHtml(ll.citation || "—"),
    ]),
  })}
</section>`;

  return layout({
    title: "Projeto IST — limites por legislação",
    active: "limits",
    body,
  });
}
