import { escapeHtml, badge, table, layout, notice } from "../lib/html.mjs";
import {
  formatDateTime,
  matrixLabel,
  sampleStatusLabel,
  verdictLabel,
} from "../lib/format.mjs";
import { stateBadge, lawBadges, stateTone } from "./overview.mjs";

const STATE_OPTIONS = [
  ["", "Todas"],
  ["compliant", "Conforme"],
  ["non_compliant", "Não conforme"],
  ["indeterminate", "Indeterminado"],
  ["not_evaluated", "Não avaliado"],
  ["no_limit", "Sem limite aplicável"],
  ["empty", "Sem resultados"],
];

const MATRIX_OPTIONS = [
  ["", "Todas"],
  ["surface", "Água superficial"],
  ["tap", "Água tratada/consumo"],
  ["ground", "Água subterrânea"],
  ["effluent", "Efluentes"],
  ["marine", "Água marinha"],
  ["precipitation", "Precipitação"],
  ["other", "Outra"],
];

function filterForm({ state = "", matrix = "" } = {}) {
  const options = (list, selected) =>
    list
      .map(
        ([value, label]) =>
          `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`,
      )
      .join("");
  return `<form class="filters" method="get" action="/amostras">
    <label>Situação
      <select name="estado">${options(STATE_OPTIONS, state)}</select>
    </label>
    <label>Matriz
      <select name="matriz">${options(MATRIX_OPTIONS, matrix)}</select>
    </label>
    <button type="submit">Filtrar</button>
    <a class="button-link" href="/amostras">Limpar</a>
  </form>`;
}

function breakdown(samples) {
  const counts = {};
  for (const s of samples) counts[s.state] = (counts[s.state] || 0) + 1;
  const order = [
    "compliant",
    "non_compliant",
    "indeterminate",
    "not_evaluated",
    "no_limit",
    "empty",
  ];
  const chips = order
    .filter((k) => counts[k])
    .map(
      (k) =>
        `<li>${badge(stateTone(k), `${verdictLabel(k)} · ${counts[k]}`)}</li>`,
    );
  if (!chips.length) return "";
  return `<ul class="chips">${chips.join("")}</ul>`;
}

export function renderSamples({ samples, filters }) {
  const rows = samples.filter((s) => {
    if (filters.state && s.state !== filters.state) return false;
    if (filters.matrix && s.matrix !== filters.matrix) return false;
    return true;
  });

  const body = `
<section>
  <h2>Amostras <span class="muted">(${rows.length} de ${samples.length})</span></h2>
  ${notice({
    tone: "",
    title: "Como ler a coluna Situação:",
    body: `o veredito é calculado por legislação a partir da vista <code>v_sample_compliance_summary</code> e depois consolidado por amostra (pior veredito vence). <em>Sem limite</em> significa que nenhuma lei carregada se aplica à matriz/data da amostra.`,
  })}
  ${filterForm(filters)}
  ${breakdown(rows)}
  ${table({
    head: [
      "Amostra",
      "Ponto de coleta",
      "Coleta",
      "Matriz",
      "Status",
      "Resultados",
      "Limites aplicáveis",
      "Situação",
      "Por legislação",
    ],
    empty: "Nenhuma amostra corresponde ao filtro (ou nenhuma amostra carregada).",
    rows: rows.map((s) => [
      `<a href="/amostras/${encodeURIComponent(s.code)}"><code>${escapeHtml(s.code)}</code></a>`,
      `${escapeHtml(s.point_name)}<br><span class="muted">${escapeHtml(s.point_code)}</span>`,
      formatDateTime(s.collected_at),
      matrixLabel(s.matrix),
      badge(
        s.status === "reported" ? "ok" : s.status === "void" ? "bad" : "neutral",
        sampleStatusLabel(s.status),
      ),
      String(s.result_count ?? 0),
      `${s.applicable_limits ?? 0} ${s.judged_limits ? `<span class="muted">(${s.judged_limits} julgados)</span>` : ""}`,
      stateBadge(s.state),
      lawBadges(s.perLaw),
    ]),
  })}
</section>`;

  return layout({
    title: "Projeto IST — amostras",
    active: "samples",
    body,
  });
}
