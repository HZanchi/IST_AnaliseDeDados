const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function attrs(map) {
  return Object.entries(map)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
    .join(" ");
}

export function badge(kind, label) {
  return `<span class="badge badge-${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
}

export function verdictBadge(verdict, labels, kinds) {
  const kind = kinds[verdict] || "neutral";
  const label = labels[verdict] || verdict || "—";
  return badge(kind, label);
}

export function table({ head, rows, empty = "Sem registros." }) {
  const thead = head.map((h) => `<th>${h}</th>`).join("");
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(empty)}</div>`;
  }
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${cell}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function stat({ value, label, hint = "", tone = "" }) {
  return `<div class="stat ${tone ? `stat-${tone}` : ""}">
    <div class="stat-value">${escapeHtml(value)}</div>
    <div class="stat-label">${escapeHtml(label)}</div>
    ${hint ? `<div class="stat-hint">${escapeHtml(hint)}</div>` : ""}
  </div>`;
}

export function statsGrid(items) {
  if (!items.length) return `<div class="empty">Sem indicadores.</div>`;
  return `<div class="stats">${items.map(stat).join("")}</div>`;
}

export function notice({ tone = "", title, body }) {
  return `<div class="notice ${tone ? `notice-${tone}` : ""}">
    <strong>${escapeHtml(title)}</strong> ${body}
  </div>`;
}

export function section(title, body, { badgeHtml = "", id = "" } = {}) {
  return `<section ${id ? `id="${escapeHtml(id)}"` : ""}>
    <h2>${escapeHtml(title)} ${badgeHtml}</h2>
    ${body}
  </section>`;
}

const NAV = [
  { id: "overview", href: "/", label: "Visão geral" },
  { id: "samples", href: "/amostras", label: "Amostras" },
  { id: "timeline", href: "/resultados", label: "Resultados" },
  { id: "comparative", href: "/comparativo", label: "Comparativo" },
  { id: "limits", href: "/limites", label: "Limites" },
  { id: "admin", href: "/admin", label: "Editar dados" },
];

export function layout({ title, active = "overview", body, subtitle = "" }) {
  const nav = NAV.map(
    (item) =>
      `<a href="${item.href}" class="${item.id === active ? "active" : ""}">${item.label}</a>`,
  ).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="topbar">
  <div class="brand">Projeto IST<span> · qualidade da água</span></div>
  <nav>${nav}</nav>
  <a class="health-link" href="/health">/health</a>
</header>
<main>
${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ""}
${body}
</main>
<footer>Dashboard de conformidade — ensaios × limites por legislação (CONAMA · WHO · EU · EPA) · renderizado no servidor, sem etapa de build</footer>
</body>
</html>`;
}

export function notFoundPage(method, pathname) {
  return layout({
    title: "404 — página não encontrada",
    body: `<section>
      <div class="hero hero-warn">
        <div class="hero-mark">?</div>
        <div>
          <h1>404 — ${escapeHtml(method)} ${escapeHtml(pathname)}</h1>
          <p>Nenhuma rota registrada para este endereço.</p>
          <p><a href="/">← Voltar para a visão geral</a></p>
        </div>
      </div>
    </section>`,
  });
}

export function errorPage(title, message) {
  return layout({
    title,
    body: `<section>
      <div class="hero hero-bad">
        <div class="hero-mark">✕</div>
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(message)}</p>
          <p><a href="/">← Voltar para a visão geral</a></p>
        </div>
      </div>
    </section>`,
  });
}
