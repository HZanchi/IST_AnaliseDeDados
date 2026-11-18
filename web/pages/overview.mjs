import {
  escapeHtml,
  badge,
  table,
  layout,
  statsGrid,
  notice,
} from "../lib/html.mjs";
import {
  formatDateTime,
  formatNumber,
  verdictLabel,
  verdictKind,
  matrixLabel,
  sampleStatusLabel,
} from "../lib/format.mjs";

function stateTone(state) {
  if (state === "compliant") return "ok";
  if (state === "non_compliant") return "bad";
  if (state === "indeterminate" || state === "not_evaluated") return "warn";
  return "neutral";
}

function stateBadge(state) {
  return badge(stateTone(state), verdictLabel(state));
}

function lawBadges(perLaw) {
  if (!perLaw.length) return `<span class="muted">—</span>`;
  return perLaw
    .map((row) => {
      const title = Number(row.verdict_count)
        ? `${row.legislation_short_name}: ${verdictLabel(row.sample_verdict)} (${Number(row.non_compliant_count)} não conformes de ${Number(row.verdict_count)})`
        : `${row.legislation_short_name}: ${verdictLabel(row.sample_verdict)}`;
      return `<span class="law-chip" title="${escapeHtml(title)}">
          ${escapeHtml(row.legislation_code)} ${badge(stateTone(row.sample_verdict), verdictLabel(row.sample_verdict))}
        </span>`;
    })
    .join(" ");
}

function recentSamplesTable(rows) {
  return table({
    head: [
      "Amostra",
      "Ponto de coleta",
      "Coleta",
      "Matriz",
      "Resultados",
      "Situação",
      "Por legislação",
    ],
    empty: "Nenhuma amostra carregada ainda.",
    rows: rows.map((s) => [
      `<a href="/amostras/${encodeURIComponent(s.code)}"><code>${escapeHtml(s.code)}</code></a>`,
      escapeHtml(s.point_name),
      formatDateTime(s.collected_at),
      matrixLabel(s.matrix),
      formatNumber(s.result_count ?? 0, { maxDigits: 0 }),
      stateBadge(s.state),
      lawBadges(s.perLaw),
    ]),
  });
}

function verdictsTable(rows) {
  return table({
    head: [
      "Amostra",
      "Parâmetro",
      "Resultado",
      "Legislação",
      "Limite",
      "Veredito",
    ],
    empty: "Nenhum veredito calculado ainda.",
    rows: rows.map((r) => [
      `<a href="/amostras/${encodeURIComponent(r.sample_code)}"><code>${escapeHtml(r.sample_code)}</code></a>`,
      escapeHtml(r.parameter_name),
      `<strong>${escapeHtml(r.result_value)}</strong> <span class="unit">${escapeHtml(r.result_unit)}</span>`,
      escapeHtml(r.legislation_short_name),
      r.limit_kind === "max"
        ? `≤ ${formatNumber(r.limit_value)} ${escapeHtml(r.limit_unit || "")}`
        : r.limit_kind === "min"
          ? `≥ ${formatNumber(r.limit_value)} ${escapeHtml(r.limit_unit || "")}`
          : r.limit_kind === "range"
            ? `${formatNumber(r.limit_lower)} – ${formatNumber(r.limit_upper)} ${escapeHtml(r.limit_unit || "")}`
            : escapeHtml(r.limit_text || "—"),
      badge(stateTone(r.verdict), verdictLabel(r.verdict)),
    ]),
  });
}

function stateBreakdown(samples) {
  const counts = {};
  for (const s of samples) {
    counts[s.state] = (counts[s.state] || 0) + 1;
  }
  const order = [
    "compliant",
    "non_compliant",
    "indeterminate",
    "not_evaluated",
    "no_limit",
    "empty",
  ];
  const items = order
    .filter((k) => counts[k])
    .map((k) => ({
      value: counts[k],
      label: verdictLabel(k),
      tone: stateTone(k),
    }));
  if (!items.length) {
    return `<div class="empty">Nenhuma amostra para resumir — carregue dados (reais ou de demonstração) para ver a conformidade.</div>`;
  }
  return statsGrid(items);
}

export function renderOverview({ overview, kpis, samples, demo }) {
  const statusBlock = overview.ok
    ? `<div class="hero hero-ok">
         <div class="hero-mark">✓</div>
         <div>
           <h1>Conexão com o banco OK</h1>
           <p>
             Postgres <code>${escapeHtml(overview.connection.host)}:${escapeHtml(overview.connection.port)}/${escapeHtml(overview.connection.database)}</code>
             respondeu em <strong>${overview.latencyMs.toFixed(1)} ms</strong> —
             servidor ${escapeHtml(overview.serverVersion)} ·
             ${escapeHtml(overview.connection.user)}
           </p>
         </div>
       </div>`
    : `<div class="hero hero-bad">
         <div class="hero-mark">✕</div>
         <div>
           <h1>Falha na conexão</h1>
           <p>${escapeHtml(overview.error)}</p>
           <p class="hint">Confira <code>DATABASE_URL</code> em <code>.env</code> e rode as migrações do banco de dados.</p>
         </div>
       </div>`;

  const emptyHint = overview.ok && !overview.hasSamples
    ? notice({
        tone: "warn",
        title: "Nenhuma amostra carregada.",
        body: `Os limites por legislação já estão no banco (${formatNumber(kpis.counts.legislation_limits)}), mas ainda não há amostras/resultados.
          Para explorar o dashboard agora, rode <code>npm run demo:seed</code> (dados de demonstração, removíveis com <code>npm run demo:purge</code>)
          ou cadastre registros pela interface de CRUD.`,
      })
    : "";

  const demoNotice = demo
    ? notice({
        tone: "warn",
        title: "Dados de demonstração em uso.",
        body: `As amostras/resultados marcados como <em>demonstração</em> existem apenas para ilustrar o dashboard enquanto não há ensaios reais no banco.
          Remova com <code>npm run demo:purge</code> antes de carregar dados reais.`,
      })
    : "";

  const technical = `
<section class="grid-2">
  <div>
    <h2>Contagens por tabela</h2>
    ${statsGrid(
      Object.entries(kpis.counts).map(([name, n]) => ({
        value: formatNumber(n, { maxDigits: 0 }),
        label: name,
      })),
    )}
  </div>
  <div>
    <h2>Cobertura técnica</h2>
    <p class="muted">Migrações aplicadas:</p>
    ${migrationList(overview.migrations)}
    <p class="muted">Views de conformidade:</p>
    ${viewList(overview.views)}
  </div>
</section>`;

  const body = `
<section>
  ${statusBlock}
  ${emptyHint}
  ${demoNotice}
</section>

<section>
  <h2>Indicadores</h2>
  ${statsGrid([
    { value: formatNumber(kpis.counts.samples, { maxDigits: 0 }), label: "amostras" },
    { value: formatNumber(kpis.counts.results, { maxDigits: 0 }), label: "resultados" },
    { value: formatNumber(kpis.verdicts.verdicts_total, { maxDigits: 0 }), label: "vereditos ativos", hint: `${formatNumber(kpis.verdicts.results_judged, { maxDigits: 0 })} resultados julgados` },
    { value: formatNumber(kpis.counts.legislation_limits, { maxDigits: 0 }), label: "limites carregados", hint: `${formatNumber(kpis.parametersWithLimits, { maxDigits: 0 })} parâmetros com limite` },
    { value: formatNumber(kpis.counts.legislations, { maxDigits: 0 }), label: "legislações" },
    { value: formatNumber(kpis.parametersMeasured, { maxDigits: 0 }), label: "parâmetros medidos" },
  ])}
</section>

<section>
  <h2>Conformidade por amostra</h2>
  ${stateBreakdown(samples)}
  <p class="muted">Regra de roll-up (vista <code>v_sample_compliance_summary</code>): qualquer veredito <em>não conforme</em> torna a amostra não conforme; <em>indeterminado</em> tem prioridade sobre <em>conforme</em>. Amostras sem limite aplicável à matriz/data aparecem como <em>Sem limite</em> — a regra de matriz do esquema impede comparar lei de água superficial com amostra de água tratada.</p>
</section>

<section>
  <h2>Amostras recentes</h2>
  ${recentSamplesTable(samples.slice(0, 12))}
  <p><a href="/amostras">Ver todas as amostras →</a></p>
</section>

<section>
  <h2>Últimos vereditos</h2>
  ${verdictsTable(overview.recentResults)}
  <p><a href="/resultados">Ver resultados no tempo →</a> · <a href="/comparativo">Comparar parâmetro × legislação →</a></p>
</section>

${technical}`;

  return layout({
    title: "Projeto IST — visão geral da conformidade",
    body,
  });
}

function migrationList(migrations) {
  if (!migrations.length) return `<div class="empty">Nenhuma migração registrada.</div>`;
  return `<ul class="chips">${migrations
    .map(
      (m) =>
        `<li><code>${escapeHtml(m.name)}</code> ${badge("ok", formatDateTime(m.applied_at))}</li>`,
    )
    .join("")}</ul>`;
}

function viewList(views) {
  if (!views.length) return `<div class="empty">Nenhuma vista encontrada.</div>`;
  return `<ul class="chips">${views
    .map((v) => `<li><code>${escapeHtml(v)}</code></li>`)
    .join("")}</ul>`;
}

export { stateTone, stateBadge, lawBadges };
