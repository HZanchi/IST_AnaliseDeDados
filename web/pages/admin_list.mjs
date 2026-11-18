import { escapeHtml, table, badge, notice, layout, section } from "../lib/html.mjs";
import { formatDateTime, formatDate, formatNumber } from "../lib/format.mjs";
import { ENTITY_ORDER, getEntity } from "../lib/entities.mjs";

export const FLASH = {
  criado: { tone: "ok", title: "Registro criado.", body: "Gravado no Postgres — confira na listagem." },
  atualizado: { tone: "ok", title: "Registro atualizado.", body: "Alterações gravadas; vereditos baseados nele foram aposentados e voltam a aparecer como “Não avaliado” até o recálculo." },
  excluido: { tone: "ok", title: "Registro excluído.", body: "Removido do Postgres (com os efeitos em cascata anunciados na confirmação)." },
  somente_leitura: { tone: "warn", title: "Modo leitura.", body: "Escrita desativada por READ_ONLY=1 — remova a variável do .env para editar." },
};

export function flashHtml(flash) {
  const f = FLASH[flash];
  if (!f) return "";
  return notice({ tone: f.tone, title: f.title, body: f.body });
}

export function readOnlyBanner(readOnly) {
  if (!readOnly) return "";
  return notice({
    tone: "warn",
    title: "Somente leitura.",
    body: "Esta instância está com <code>READ_ONLY=1</code>: os formulários ficam desativados e toda gravação é recusada. É o interruptor de segurança previsto no PRO-9 — remova a variável do <code>.env</code> para voltar a editar.",
  });
}

export function adminPath(key, rest = "") {
  return `/admin/${key}${rest}`;
}

export function renderAdminHome({ counts, readOnly }) {
  const cards = ENTITY_ORDER.map((key) => {
    const entity = getEntity(key);
    const n = counts[key];
    return `<a class="admin-card" href="${adminPath(key)}">
      <span class="admin-card-title">${escapeHtml(entity.title)}</span>
      <span class="admin-card-count">${n === null || n === undefined ? "?" : escapeHtml(String(n))}</span>
      <span class="admin-card-hint">${escapeHtml(entity.description)}</span>
    </a>`;
  }).join("");

  const body = `
<section>
  <h2>Editar dados <span class="muted">CRUD direto no Postgres</span></h2>
  ${readOnlyBanner(readOnly)}
  ${notice({
    tone: "",
    title: "O que esta área faz:",
    body: "inspeciona e altera as tabelas do esquema de <a href=\"/\">qualidade da água</a> sem passar por linha de comando. Criação e edição passam por validação no servidor e pelo banco; exclusão sempre em duas etapas, com aviso do que será afetado.",
  })}
  <div class="admin-grid">${cards}</div>
  <p class="muted">Erros do Postgres (duplicidade, chave estrangeira, regra de verificação) voltam traduzidos em português — nada falha em silêncio.</p>
</section>`;

  return layout({ title: "Projeto IST — editar dados", active: "admin", body, subtitle: "Inspecione e altere amostras, resultados, parâmetros e limites." });
}

export function renderEntityList({ entityKey, entity, list, search, page, readOnly, flash }) {
  const rows = list.rows.map((row) => {
    const cells = entity.list.columns.map((c) => c.render(row));
    const id = row.id;
    const actions = readOnly
      ? `<span class="muted">somente leitura</span>`
      : `<a class="btn btn-small" href="${adminPath(entityKey, `/${id}/editar`)}">Editar</a>
         <a class="btn btn-small btn-danger-ghost" href="${adminPath(entityKey, `/${id}/excluir`)}">Excluir</a>`;
    return [...cells, `<span class="row-actions">${actions}</span>`];
  });

  const head = [...entity.list.columns.map((c) => c.label), "Ações"];
  const searchForm = entity.list.search?.length
    ? `<form class="filters" method="get" action="${adminPath(entityKey)}">
        <label>Buscar <input type="search" name="busca" value="${escapeHtml(search || "")}" placeholder="texto em ${escapeHtml(entity.list.search.join(", "))}"></label>
        <button type="submit">Buscar</button>
        ${search ? `<a class="button-link" href="${adminPath(entityKey)}">Limpar</a>` : ""}
      </form>`
    : "";

  const pager = list.pages > 1
    ? `<nav class="pager">
        ${page > 1 ? `<a href="${adminPath(entityKey, `?busca=${encodeURIComponent(search || "")}&pagina=${page - 1}`)}">← anterior</a>` : ""}
        <span>página ${page} de ${list.pages} · ${list.total} registro(s)</span>
        ${page < list.pages ? `<a href="${adminPath(entityKey, `?busca=${encodeURIComponent(search || "")}&pagina=${page + 1}`)}">próxima →</a>` : ""}
      </nav>`
    : `<p class="muted">${list.total} registro(s).</p>`;

  const newButton = readOnly
    ? ""
    : `<a class="btn" href="${adminPath(entityKey, "/novo")}">+ Novo ${escapeHtml(entity.singular.toLowerCase())}</a>`;

  const body = `
<section>
  <h2>${escapeHtml(entity.title)} <span class="muted">${entity.list.columns.length} colunas exibidas</span></h2>
  ${flashHtml(flash)}
  ${readOnlyBanner(readOnly)}
  <p>${escapeHtml(entity.description)}</p>
  <div class="toolbar">
    ${newButton}
    <a class="button-link" href="/admin">← todas as entidades</a>
  </div>
  ${searchForm}
  ${table({
    head,
    empty: "Nenhum registro encontrado.",
    rows,
  })}
  ${pager}
</section>`;

  return layout({
    title: `Projeto IST — ${entity.title}`,
    active: "admin",
    body,
    subtitle: `Entidade <code>${escapeHtml(entity.table)}</code>`,
  });
}
