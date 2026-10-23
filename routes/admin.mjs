import {
  ENTITY_ORDER,
  getEntity,
  isUuid,
} from "../lib/entities.mjs";
import {
  coerceValues,
  displayValues,
  loadOptions,
  listRows,
  getRow,
  insertRow,
  updateRow,
  deleteRow,
  deleteImpact,
  mapDbError,
} from "../lib/crud.mjs";
import { isReadOnly } from "../lib/config.mjs";
import { query as dbQuery } from "../lib/db.mjs";
import {
  renderAdminHome,
  renderEntityList,
  adminPath,
} from "../pages/admin_list.mjs";
import {
  renderEntityForm,
  renderEntityDetail,
  renderConfirmDelete,
} from "../pages/admin_form.mjs";
import { errorPage, layout } from "../lib/html.mjs";

const HTML = { "content-type": "text/html; charset=utf-8" };

function html(body, status = 200, extraHeaders = {}) {
  return { status, headers: { ...HTML, ...extraHeaders }, body };
}

function redirect(location) {
  return { status: 303, headers: { location }, body: "" };
}

function notFoundEntity(key) {
  return html(
    errorPage(
      "Entidade desconhecida",
      `Não existe a entidade "${key}" no editor. Disponíveis: ${ENTITY_ORDER.join(", ")}.`,
    ),
    404,
  );
}

function readOnlyPage() {
  return html(
    layout({
      title: "Escrita desativada",
      active: "admin",
      body: `<section>
        <div class="hero hero-warn">
          <div class="hero-mark">!</div>
          <div>
            <h1>Modo somente leitura</h1>
            <p>Esta instância está rodando com <code>READ_ONLY=1</code>: a gravação é recusada por segurança.</p>
            <p>Remova a variável do <code>.env</code> (ou do ambiente) e reinicie o servidor para voltar a editar.</p>
            <p><a href="/admin">← Voltar para o editor</a></p>
          </div>
        </div>
      </section>`,
    }),
    403,
  );
}

async function counts() {
  const out = {};
  await Promise.all(
    ENTITY_ORDER.map(async (key) => {
      const entity = getEntity(key);
      try {
        const res = await dbQuery(`SELECT count(*)::int AS n FROM ${entity.table}`);
        out[key] = res.rows[0].n;
      } catch {
        out[key] = null;
      }
    }),
  );
  return out;
}

function optionMembershipErrors(entity, values, options) {
  const errors = [];
  for (const field of entity.fields) {
    if (field.type !== "select") continue;
    if (field.showIf) {
      try {
        if (!field.showIf(values)) continue;
      } catch {
        continue;
      }
    }
    const v = values[field.name];
    if (v === null || v === undefined || v === "") continue;
    const list = field.options && field.options.sql
      ? options[field.name] || []
      : (field.options || []);
    if (!list.length) continue;
    const ok = list.some(([opt]) => String(opt) === String(v));
    if (!ok) {
      errors.push({
        field: field.name,
        message: `${field.label}: "${v}" não é uma opção válida (recarregue a página e escolha da lista).`,
      });
    }
  }
  return errors;
}

async function validateSubmission(entity, raw, { query }) {
  const { values, errors } = coerceValues(entity, raw);
  const options = await loadOptions(entity);
  errors.push(...optionMembershipErrors(entity, values, options));
  const extra = await entity.validate(values, { query });
  errors.push(...extra);
  return { values, options, errors };
}

function formResponse({ entityKey, entity, values, errors, mode, options, flash = "" }, status = 200) {
  return html(renderEntityForm({ entityKey, entity, values, errors, mode, options, readOnly: isReadOnly(), flash }), status);
}

async function listEntity({ key, entity, query, readOnly }) {
  const search = (query.get("busca") || "").trim();
  const page = Number.parseInt(query.get("pagina") || "1", 10);
  const list = await listRows(entity, { search, page: Number.isNaN(page) ? 1 : page });
  return html(
    renderEntityList({
      entityKey: key,
      entity,
      list,
      search,
      page: list.page,
      readOnly,
      flash: query.get("flash") || "",
    }),
  );
}

export const adminRoutes = [
  {
    method: "GET",
    path: "/admin",
    handler: async () => html(renderAdminHome({ counts: await counts(), readOnly: isReadOnly() })),
  },
  {
    method: "GET",
    path: "/admin/:entity",
    handler: async ({ params, query }) => {
      const entity = getEntity(params.entity);
      if (!entity) return notFoundEntity(params.entity);
      return listEntity({ key: params.entity, entity, query, readOnly: isReadOnly() });
    },
  },
  {
    method: "GET",
    path: "/admin/:entity/novo",
    handler: async ({ params }) => {
      const entity = getEntity(params.entity);
      if (!entity) return notFoundEntity(params.entity);
      if (isReadOnly()) return readOnlyPage();
      const values = displayValues(entity, null);
      const options = await loadOptions(entity);
      return formResponse({ entityKey: params.entity, entity, values, errors: [], mode: "create", options });
    },
  },
  {
    method: "POST",
    path: "/admin/:entity",
    handler: async ({ params, body, query }) => {
      const entity = getEntity(params.entity);
      if (!entity) return notFoundEntity(params.entity);
      if (isReadOnly()) return readOnlyPage();

      const { values, options, errors } = await validateSubmission(entity, body || {}, { query: dbQuery });
      if (errors.length) {
        return formResponse({ entityKey: params.entity, entity, values, errors, mode: "create", options }, 422);
      }
      try {
        await insertRow(entity, values);
      } catch (err) {
        if (err.validationError) {
          errors.push(err.validationError);
          return formResponse({ entityKey: params.entity, entity, values, errors, mode: "create", options }, 422);
        }
        if (err.code) {
          const mapped = mapDbError(err);
          if (mapped.field) errors.push(mapped);
          else errors.push({ field: null, message: mapped.message });
          return formResponse({ entityKey: params.entity, entity, values, errors, mode: "create", options }, 422);
        }
        throw err;
      }
      return redirect(adminPath(params.entity, "?flash=criado"));
    },
  },
  {
    method: "GET",
    path: "/admin/:entity/:id",
    handler: async ({ params, query }) => {
      const entity = getEntity(params.entity);
      if (!entity) return notFoundEntity(params.entity);
      if (!isUuid(params.id)) {
        return html(errorPage("Registro não encontrado", "Identificador inválido — o id é um UUID."), 404);
      }
      const row = await getRow(entity, params.id);
      if (!row) {
        return html(errorPage("Registro não encontrado", `Nenhum registro em ${entity.table} com esse id (talvez já tenha sido excluído).`), 404);
      }
      const impact = await deleteImpact(entity, params.id);
      return html(
        renderEntityDetail({
          entityKey: params.entity,
          entity,
          row,
          impact,
          readOnly: isReadOnly(),
          flash: query.get("flash") || "",
        }),
      );
    },
  },
  {
    method: "GET",
    path: "/admin/:entity/:id/editar",
    handler: async ({ params }) => {
      const entity = getEntity(params.entity);
      if (!entity) return notFoundEntity(params.entity);
      if (isReadOnly()) return redirect(adminPath(params.entity, `/${params.id}`));
      if (!isUuid(params.id)) {
        return html(errorPage("Registro não encontrado", "Identificador inválido — o id é um UUID."), 404);
      }
      const row = await getRow(entity, params.id);
      if (!row) {
        return html(errorPage("Registro não encontrado", `Nenhum registro em ${entity.table} com esse id.`), 404);
      }
      const values = { ...displayValues(entity, row), __id: row.id };
      const options = await loadOptions(entity);
      return formResponse({ entityKey: params.entity, entity, values, errors: [], mode: "edit", options });
    },
  },
  {
    method: "POST",
    path: "/admin/:entity/:id",
    handler: async ({ params, body, query }) => {
      const entity = getEntity(params.entity);
      if (!entity) return notFoundEntity(params.entity);
      if (isReadOnly()) return readOnlyPage();
      if (!isUuid(params.id)) {
        return html(errorPage("Registro não encontrado", "Identificador inválido — o id é um UUID."), 404);
      }
      const row = await getRow(entity, params.id);
      if (!row) {
        return html(errorPage("Registro não encontrado", `Nenhum registro em ${entity.table} com esse id.`), 404);
      }

      const { values, options, errors } = await validateSubmission(entity, body || {}, { query: dbQuery });
      values.__id = params.id;
      if (errors.length) {
        return formResponse({ entityKey: params.entity, entity, values, errors, mode: "edit", options }, 422);
      }
      try {
        await updateRow(entity, params.id, values);
      } catch (err) {
        if (err.notFound) {
          return html(errorPage("Registro não encontrado", "O registro sumiu entre o formulário e o envio."), 404);
        }
        if (err.validationError) {
          errors.push(err.validationError);
          return formResponse({ entityKey: params.entity, entity, values, errors, mode: "edit", options }, 422);
        }
        if (err.code) {
          const mapped = mapDbError(err);
          errors.push({ field: mapped.field, message: mapped.message });
          return formResponse({ entityKey: params.entity, entity, values, errors, mode: "edit", options }, 422);
        }
        throw err;
      }
      return redirect(adminPath(params.entity, `/${params.id}?flash=atualizado`));
    },
  },
  {
    method: "GET",
    path: "/admin/:entity/:id/excluir",
    handler: async ({ params, query }) => {
      const entity = getEntity(params.entity);
      if (!entity) return notFoundEntity(params.entity);
      if (!isUuid(params.id)) {
        return html(errorPage("Registro não encontrado", "Identificador inválido — o id é um UUID."), 404);
      }
      const row = await getRow(entity, params.id);
      if (!row) {
        return html(errorPage("Registro não encontrado", `Nenhum registro em ${entity.table} com esse id.`), 404);
      }
      const impact = await deleteImpact(entity, params.id);
      return html(
        renderConfirmDelete({
          entityKey: params.entity,
          entity,
          row,
          impact,
          error: query.get("erro") || null,
          readOnly: isReadOnly(),
        }),
      );
    },
  },
  {
    method: "POST",
    path: "/admin/:entity/:id/excluir",
    handler: async ({ params }) => {
      const entity = getEntity(params.entity);
      if (!entity) return notFoundEntity(params.entity);
      if (isReadOnly()) return readOnlyPage();
      if (!isUuid(params.id)) {
        return html(errorPage("Registro não encontrado", "Identificador inválido — o id é um UUID."), 404);
      }
      const row = await getRow(entity, params.id);
      if (!row) {
        return html(errorPage("Registro não encontrado", `Nenhum registro em ${entity.table} com esse id.`), 404);
      }
      try {
        await deleteRow(entity, params.id);
      } catch (err) {
        if (err.notFound) {
          return html(errorPage("Registro não encontrado", "O registro já não existe."), 404);
        }
        if (err.code === "23503") {
          const impact = await deleteImpact(entity, params.id);
          return html(
            renderConfirmDelete({
              entityKey: params.entity,
              entity,
              row,
              impact,
              error: `Este registro não pode ser excluído: ainda há registros dependentes apontando para ele (${err.constraint || "chave estrangeira"}). Exclua-os ou resolva as referências primeiro — nada foi apagado.`,
              readOnly: false,
            }),
            409,
          );
        }
        if (err.code === "23514") {
          const impact = await deleteImpact(entity, params.id);
          return html(
            renderConfirmDelete({
              entityKey: params.entity,
              entity,
              row,
              impact,
              error: `O banco recusou a exclusão por uma regra de verificação (${err.constraint || "check"}).`,
              readOnly: false,
            }),
            409,
          );
        }
        if (err.code) {
          const impact = await deleteImpact(entity, params.id);
          return html(
            renderConfirmDelete({
              entityKey: params.entity,
              entity,
              row,
              impact,
              error: mapDbError(err).message,
              readOnly: false,
            }),
            409,
          );
        }
        throw err;
      }
      return redirect(adminPath(params.entity, "?flash=excluido"));
    },
  },
];
