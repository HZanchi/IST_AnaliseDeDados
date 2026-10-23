import { escapeHtml, notice, layout, badge, table } from "../lib/html.mjs";
import { formatDateTime, formatDate, formatNumber, limitKindLabel, conversionLabel } from "../lib/format.mjs";
import { renderFormFields, renderErrors } from "../lib/forms.mjs";
import { adminPath, flashHtml, readOnlyBanner } from "./admin_list.mjs";

function displayValue(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "checkbox":
      return value === true || value === "t" || value === 1 ? "sim" : "não";
    case "datetime":
      return formatDateTime(value);
    case "date":
      return formatDate(value);
    case "number":
    case "integer":
      return formatNumber(value, { maxDigits: 6 });
    case "csv":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "select": {
      if (field.options && !field.options.sql) {
        const hit = (field.options || []).find(([v]) => String(v) === String(value));
        if (hit) return hit[1];
      }
      if (field.name === "limit_kind") return limitKindLabel(value);
      if (field.name === "conversion_status") return conversionLabel(value);
      return String(value);
    }
    default:
      return String(value);
  }
}

export function renderEntityForm({ entityKey, entity, values, errors = [], mode, options = {}, readOnly, flash }) {
  const isNew = mode === "create";
  const action = isNew
    ? adminPath(entityKey, "")
    : adminPath(entityKey, `/${values.__id}/editar`);
  const title = `${entity.singular} — ${isNew ? "novo registro" : "edição"}`;

  const body = `
<section>
  <h2>${escapeHtml(title)}</h2>
  ${flashHtml(flash)}
  ${readOnlyBanner(readOnly)}
  ${renderErrors(errors)}
  <form method="post" action="${escapeHtml(action)}" class="entity-form" novalidate>
    <div class="form-grid">
      ${renderFormFields(entity, values, { options, errors })}
    </div>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">${isNew ? "Criar registro" : "Salvar alterações"}</button>
      <a class="button-link" href="${adminPath(entityKey)}">Cancelar</a>
      ${isNew ? "" : `<a class="button-link btn-danger-ghost" href="${adminPath(entityKey, `/${values.__id}/excluir`)}">Excluir…</a>`}
    </div>
  </form>
  <p class="muted">* obrigatório · validação roda no servidor e de novo no banco; erros do Postgres voltam traduzidos.</p>
</section>`;

  return layout({
    title: `Projeto IST — ${title}`,
    active: "admin",
    body,
    subtitle: `entidade <code>${escapeHtml(entity.table)}</code>`,
  });
}

export function renderEntityDetail({ entityKey, entity, row, impact = [], readOnly, flash }) {
  const fields = entity.fields
    .filter((f) => !f.showIf || (() => { try { return Boolean(f.showIf(row)); } catch { return true; } })())
    .map((f) => `<tr><th>${escapeHtml(f.label)}</th><td>${escapeHtml(displayValue(f, row[f.name]))}</td></tr>`);

  const meta = ["id", "created_at", "updated_at"]
    .filter((k) => row[k] !== undefined && row[k] !== null)
    .map((k) => {
      const value = k === "id" ? String(row[k]) : (formatDateTime(row[k]) || String(row[k]));
      return `<tr><th class="muted">${escapeHtml(k)}</th><td class="muted">${escapeHtml(value)}</td></tr>`;
    });

  const impactList = impact.filter((i) => i.count > 0);
  const impactHtml = impactList.length
    ? notice({
        tone: impactList.some((i) => i.behavior === "restrict") ? "warn" : "",
        title: "Dependências atuais:",
        body: impactList
          .map((i) => `${i.count} ${escapeHtml(i.label)} (${i.behavior === "restrict" ? "bloqueia exclusão" : "será apagado em cascata"})`)
          .join(" · "),
      })
    : "";

  const actions = readOnly
    ? ""
    : `<div class="toolbar">
        <a class="btn" href="${adminPath(entityKey, `/${row.id}/editar`)}">Editar</a>
        <a class="btn btn-danger-ghost" href="${adminPath(entityKey, `/${row.id}/excluir`)}">Excluir…</a>
        <a class="button-link" href="${adminPath(entityKey)}">← ${escapeHtml(entity.title)}</a>
      </div>`;

  const body = `
<section>
  <h2>${escapeHtml(entity.singular)} <code>${escapeHtml(String(row[entity.unique?.[0]?.cols[0] || "id"] ?? row.id).slice(0, 60))}</code></h2>
  ${flashHtml(flash)}
  ${readOnlyBanner(readOnly)}
  ${impactHtml}
  ${actions}
  <div class="table-wrap"><table class="detail-table">
    <tbody>${fields.join("")}${meta.join("")}</tbody>
  </table></div>
</section>`;

  return layout({
    title: `Projeto IST — ${entity.singular}`,
    active: "admin",
    body,
    subtitle: `entidade <code>${escapeHtml(entity.table)}</code>`,
  });
}

export function renderConfirmDelete({ entityKey, entity, row, impact = [], error = null, readOnly }) {
  const title = String(row[entity.unique?.[0]?.cols[0] || "id"] ?? row.id).slice(0, 60);

  const impactRows = impact.map((i) => [
    escapeHtml(i.label),
    String(i.count),
    i.count === 0
      ? badge("neutral", "nada a afetar")
      : i.behavior === "cascade"
        ? badge("warn", "apagado em cascata")
        : badge("bad", "bloqueia a exclusão"),
  ]);

  const blocking = impact.some((i) => i.behavior === "restrict" && i.count > 0);

  const body = `
<section>
  <h2>Excluir ${escapeHtml(entity.singular)} <code>${escapeHtml(title)}</code>?</h2>
  ${readOnlyBanner(readOnly)}
  ${error ? notice({ tone: "bad", title: "Não foi possível excluir.", body: escapeHtml(error) }) : ""}
  ${notice({
    tone: blocking ? "warn" : "bad",
    title: "Exclusão em duas etapas.",
    body: blocking
      ? "Este registro tem dependências com restrição: o banco vai recusar a exclusão até elas serem resolvidas (o erro aparece aqui)."
      : "Confira o impacto abaixo — a segunda etapa é o POST que de fato apaga. Não há exclusão em massa nem atalho silencioso.",
  })}
  ${table({
    head: ["O que será afetado", "Quantidade", "Comportamento"],
    rows: impactRows,
    empty: "Esta entidade não tem dependências declaradas.",
  })}
  <form method="post" action="${escapeHtml(adminPath(entityKey, `/${row.id}/excluir`))}" class="entity-form">
    <div class="form-actions">
      <button type="submit" class="btn btn-danger" ${blocking ? "disabled" : ""}>${blocking ? "Bloqueado pelo banco" : "Sim, excluir definitivamente"}</button>
      <a class="button-link" href="${adminPath(entityKey, `/${row.id}`)}">Cancelar</a>
      <a class="button-link" href="${adminPath(entityKey)}">← ${escapeHtml(entity.title)}</a>
    </div>
  </form>
</section>`;

  return layout({
    title: `Projeto IST — confirmar exclusão`,
    active: "admin",
    body,
    subtitle: `entidade <code>${escapeHtml(entity.table)}</code>`,
  });
}
