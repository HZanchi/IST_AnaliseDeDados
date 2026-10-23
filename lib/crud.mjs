import { query } from "./db.mjs";

const PAGE_SIZE = 25;

const typeCache = new Map();

async function columnTypes(table) {
  if (typeCache.has(table)) return typeCache.get(table);
  const { rows } = await query(
    `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const map = {};
  for (const r of rows) map[r.column_name] = r;
  typeCache.set(table, map);
  return map;
}

function castFor(type, value) {
  if (value === null || value === undefined) return "";
  if (!type) return "";
  if (type.data_type === "ARRAY") return "::text[]";
  switch (type.data_type) {
    case "uuid":
      return "::uuid";
    case "numeric":
      return "::numeric";
    case "integer":
      return "::integer";
    case "timestamp with time zone":
      return "::timestamptz";
    case "timestamp without time zone":
      return "::timestamp";
    case "date":
      return "::date";
    case "boolean":
      return "::boolean";
    case "jsonb":
    case "json":
      return "::jsonb";
    default:
      return "";
  }
}

const SP_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Interprets a naive wall-clock string as America/Sao_Paulo local time and
 * returns an ISO instant (with Z). Keeps writes independent of the session
 * TimeZone: the form is the user's local clock, the column is an instant.
 */
function saoPauloToIso(naive) {
  const parsed = Date.parse(`${naive}Z`);
  if (Number.isNaN(parsed)) return null;
  const probe = new Date(parsed);
  const parts = Object.fromEntries(SP_FMT.formatToParts(probe).map((p) => [p.type, p.value]));
  const wall = Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
  );
  if (Number.isNaN(wall)) return null;
  const offset = wall - parsed;
  const iso = new Date(parsed - offset).toISOString();
  return iso;
}

function shown(field, values) {
  if (!field.showIf) return true;
  try {
    return Boolean(field.showIf(values));
  } catch {
    return true;
  }
}

export function coerceValues(entity, raw) {
  const values = {};
  const errors = [];

  for (const field of entity.fields) {
    const rawValue = raw[field.name];

    switch (field.type) {
      case "checkbox": {
        values[field.name] = rawValue === "on" || rawValue === "true" || rawValue === "1";
        break;
      }
      case "number":
      case "integer": {
        const text = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
        if (text === "") {
          values[field.name] = null;
          break;
        }
        const n = Number(text.replace(",", "."));
        if (Number.isNaN(n)) {
          errors.push({ field: field.name, message: `${field.label} precisa ser um número válido (recebido: "${text}").` });
          values[field.name] = null;
          break;
        }
        if (field.type === "integer" && !Number.isInteger(n)) {
          errors.push({ field: field.name, message: `${field.label} precisa ser um número inteiro.` });
          values[field.name] = null;
          break;
        }
        values[field.name] = n;
        break;
      }
      case "datetime": {
        const text = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
        if (text === "") {
          values[field.name] = null;
          break;
        }
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) {
          errors.push({ field: field.name, message: `${field.label} deve estar no formato data e hora (AAAA-MM-DDTHH:MM).` });
          values[field.name] = null;
          break;
        }
        const iso = saoPauloToIso(text);
        if (!iso) {
          errors.push({ field: field.name, message: `${field.label} não é uma data/hora válida.` });
          values[field.name] = null;
          break;
        }
        values[field.name] = iso;
        break;
      }
      case "date": {
        const text = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
        if (text === "") {
          values[field.name] = null;
          break;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
          errors.push({ field: field.name, message: `${field.label} deve estar no formato AAAA-MM-DD.` });
          values[field.name] = null;
          break;
        }
        values[field.name] = text;
        break;
      }
      case "csv": {
        const text = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
        values[field.name] = text === ""
          ? []
          : text.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
        break;
      }
      case "json": {
        const text = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
        if (text === "") {
          values[field.name] = null;
          break;
        }
        try {
          values[field.name] = JSON.parse(text);
        } catch {
          errors.push({ field: field.name, message: `${field.label} não é um JSON válido.` });
          values[field.name] = null;
        }
        break;
      }
      default: {
        const text = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
        values[field.name] = text === "" ? null : text;
      }
    }
  }

  for (const field of entity.fields) {
    if (shown(field, values) && field.required && (values[field.name] === null || values[field.name] === "" || values[field.name] === undefined)) {
      errors.push({ field: field.name, message: `${field.label} é um campo obrigatório.` });
    }
  }

  return { values, errors };
}

export function displayValues(entity, row) {
  const out = {};
  for (const field of entity.fields) {
    const v = row ? row[field.name] : undefined;
    switch (field.type) {
      case "checkbox":
        out[field.name] = v === true || v === "t" || v === 1 || v === "1";
        break;
      case "number":
      case "integer":
        out[field.name] = v === null || v === undefined ? "" : String(v);
        break;
      case "csv":
        out[field.name] = Array.isArray(v) ? v.join(", ") : (v || "");
        break;
      case "datetime":
        out[field.name] = toInputDateTime(v);
        break;
      case "date":
        out[field.name] = toInputDate(v);
        break;
      default:
        out[field.name] = v === null || v === undefined ? "" : String(v);
    }
  }
  if (!row && entity.defaults) {
    for (const [key, value] of Object.entries(entity.defaults)) {
      const field = entity.fields.find((f) => f.name === key);
      if (field && field.type === "checkbox") {
        out[key] = Boolean(value);
        continue;
      }
      if (out[key] === "" || out[key] === null || out[key] === undefined) {
        out[key] = String(value);
      }
    }
  }
  return out;
}

const TZ_FMT_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const TZ_FMT_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toInputDateTime(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(TZ_FMT_DATE_TIME.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function toInputDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return TZ_FMT_DATE.format(d);
}

export async function loadOptions(entity) {
  const options = {};
  const jobs = entity.fields
    .filter((f) => f.type === "select" && f.options && f.options.sql)
    .map(async (f) => {
      const { rows } = await query(f.options.sql);
      options[f.name] = rows.map((r) => [String(r.value), String(r.label)]);
    });
  await Promise.all(jobs);
  return options;
}

function searchClause(searchCols, paramIndex) {
  if (!searchCols || !searchCols.length) return { sql: "", params: [] };
  const pattern = `$${paramIndex}`;
  const sql = `(${searchCols.map((c) => `${c}::text ILIKE ${pattern}`).join(" OR ")})`;
  return { sql, params: [pattern] };
}

export async function listRows(entity, { search = "", page = 1 } = {}) {
  const base = entity.list.sql ? `(${entity.list.sql})` : entity.table;
  const where = search
    ? `WHERE ${searchClause(entity.list.search, 1).sql}`
    : "";
  const params = search ? [`%${search.trim()}%`] : [];

  const countRes = await query(
    `SELECT count(*)::int AS n FROM ${base} t ${where}`,
    params,
  );
  const total = countRes.rows[0].n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const offset = (current - 1) * PAGE_SIZE;

  const dataParams = [...params, PAGE_SIZE, offset];
  const data = await query(
    `SELECT * FROM ${base} t
       ${where}
      ORDER BY ${entity.list.order}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams,
  );

  return { rows: data.rows, total, page: current, pages };
}

export async function getRow(entity, id) {
  const { rows } = await query(`SELECT * FROM ${entity.table} WHERE id = $1::uuid`, [id]);
  return rows[0] || null;
}

async function checkUnique(entity, values, id = null) {
  for (const rule of entity.unique || []) {
    const params = [];
    const conds = [];
    for (const col of rule.cols) {
      params.push(values[col]);
      conds.push(col);
    }
    const where = `(${conds.join(", ")}) = (${rule.cols.map((_, i) => `$${i + 1}`).join(", ")})`;
    if (id) {
      params.push(id);
      const { rows } = await query(
        `SELECT id FROM ${entity.table} WHERE ${where} AND id <> $${params.length}`,
        params,
      );
      if (rows.length) return rule.cols;
    } else {
      const { rows } = await query(`SELECT id FROM ${entity.table} WHERE ${where}`, params);
      if (rows.length) return rule.cols;
    }
  }
  return null;
}

const CONSTRAINT_MESSAGES = {
  samples_code_key: { field: "code", message: "Já existe uma amostra com este código." },
  sampling_points_code_key: { field: "code", message: "Já existe um ponto de coleta com este código." },
  test_parameters_code_key: { field: "code", message: "Já existe um parâmetro com este código." },
  legislations_code_key: { field: "code", message: "Já existe uma legislação com este código." },
  results_sample_id_parameter_id_replicate_key: { field: "replicate", message: "Já existe um resultado para esta amostra, parâmetro e réplica — use outra réplica." },
  legislation_limits_legislation_id_parameter_id_limit_kind_limit_tier_key: { field: "parameter_id", message: "Já existe um limite igual para esta legislação, parâmetro, tipo e nível." },
  results_sample_id_fkey: { field: "sample_id", message: "A amostra referenciada não existe mais." },
  results_parameter_id_fkey: { field: "parameter_id", message: "O parâmetro referenciado não existe mais." },
  samples_sampling_point_id_fkey: { field: "sampling_point_id", message: "O ponto de coleta referenciado não existe mais." },
  legislation_limits_legislation_id_fkey: { field: "legislation_id", message: "A legislação referenciada não existe mais." },
  legislation_limits_parameter_id_fkey: { field: "parameter_id", message: "O parâmetro referenciado não existe mais." },
  compliance_verdicts_legislation_limit_id_fkey: { field: "id", message: "Não é possível excluir: vereditos ainda referenciam este limite." },
  compliance_verdicts_result_id_fkey: { field: "id", message: "Não é possível excluir: vereditos ainda referenciam este resultado." },
  results_check: { field: "value_numeric", message: "Informe valor numérico ou textual (ao menos um)." },
  results_check1: { field: "censored", message: "Valor censurado exige valor numérico." },
  results_check2: { field: "reported_at", message: "Data do laudo não pode ser anterior à medição." },
  samples_check: { field: "received_at", message: "Recebida em não pode ser anterior à coleta." },
  samples_depth_m_check: { field: "depth_m", message: "Profundidade não pode ser negativa." },
  samples_temperature_c_check: { field: "temperature_c", message: "Temperatura fora do intervalo aceito (-20 a 100 °C)." },
  samples_volume_l_check: { field: "volume_l", message: "Volume precisa ser maior que zero." },
  samples_status_check: { field: "status", message: "Status de amostra inválido." },
  samples_matrix_not_null: { field: "matrix", message: "Matriz é obrigatória." },
  test_parameters_check: { field: "unit", message: "Parâmetro de texto não pode ter unidade." },
  test_parameters_check1: { field: "detection_limit", message: "Limite de detecção maior que o limite de relato." },
  test_parameters_check2: { field: "ideal_range_lower", message: "Faixa ideal invertida (inferior maior que superior)." },
  test_parameters_category_check: { field: "category", message: "Categoria inválida." },
  test_parameters_data_type_check: { field: "data_type", message: "Tipo de dado inválido." },
  legislations_check: { field: "effective_to", message: "Fim da vigência anterior ao início." },
  legislation_limits_check: { field: "limit_value", message: "Combinação inválida de tipo de limite e valores (canônico/publicado/faixa/texto)." },
  legislation_limits_check1: { field: "unit", message: "Limite não textual precisa de unidade." },
  legislation_limits_check2: { field: "effective_to", message: "Fim da vigência anterior ao início." },
  legislation_limits_check3: { field: "limit_value", message: "Combinação inválida de tipo de limite e valores." },
  legislation_limits_published_numeric_chk: { field: "published_value", message: "Valores publicados incompatíveis com o tipo de limite (unidade publicada é obrigatória para tipos não textuais)." },
  legislation_limits_conversion_note_chk: { field: "conversion_note", message: "Conversão convertida ou ambígua exige nota da conversão." },
  legislation_limits_conversion_status_check: { field: "conversion_status", message: "Status de conversão inválido." },
  legislation_limits_limit_kind_check: { field: "limit_kind", message: "Tipo de limite inválido." },
  legislation_limits_limit_tier_check: { field: "limit_tier", message: "Nível de limite inválido." },
  legislation_limits_basis_check: { field: "basis", message: "Base de avaliação inválida." },
  legislation_limits_max_non_compliance_count_check: { field: "max_non_compliance_count", message: "Quantidade de não conformes não pode ser negativa." },
  legislation_limits_max_non_compliance_rate_check: { field: "max_non_compliance_rate", message: "Taxa de não conformes deve ficar entre 0 e 1." },
  sampling_points_source_type_check: { field: "source_type", message: "Tipo de fonte inválido." },
  sampling_points_latitude_check: { field: "latitude", message: "Latitude fora de -90 a 90." },
  sampling_points_longitude_check: { field: "longitude", message: "Longitude fora de -180 a 180." },
};

export function mapDbError(err) {
  const code = err.code;
  const constraint = err.constraint || "";
  const known = CONSTRAINT_MESSAGES[constraint];
  if (known) return known;

  switch (code) {
    case "23505":
      return { field: null, message: `Valor duplicado em restrição única do banco (${constraint}). Revise os campos de identificação.` };
    case "23503":
      return { field: null, message: `Registro referenciado não existe (${constraint}). Atualize a página e escolha uma opção válida.` };
    case "23514":
      return { field: null, message: `O banco recusou o valor: regra de verificação violada (${constraint}). Revise os campos do formulário.` };
    case "23502":
      return { field: err.column || null, message: `Campo obrigatório sem valor: ${err.column}.` };
    case "22001":
      return { field: err.column || null, message: `Texto longo demais para o campo ${err.column}.` };
    case "22P02":
      return { field: err.column || null, message: `Formato inválido para o tipo de dado esperado pelo banco (${err.column || constraint}).` };
    default:
      return { field: null, message: `Erro do banco de dados: ${err.message}` };
  }
}

export async function insertRow(entity, values) {
  const types = await columnTypes(entity.table);
  const dup = await checkUnique(entity, values);
  if (dup) {
    const rule = entity.unique.find((r) => r.cols.join() === dup.join());
    const field = dup[0];
    const label = rule.labels[field] || field;
    const err = new Error("duplicado");
    err.validationError = { field, message: `Já existe um registro com ${label} igual a "${values[field]}".` };
    throw err;
  }

  const fields = entity.fields.filter((f) => f.type !== "computed");
  const cols = fields.map((f) => f.name);
  const params = fields.map((f, i) => {
    const v = shown(f, values) ? values[f.name] : null;
    return v === null || v === undefined ? `$${i + 1}` : `$${i + 1}${castFor(types[f.name], v)}`;
  });
  const row = await query(
    `INSERT INTO ${entity.table} (${cols.join(", ")}) VALUES (${params.join(", ")}) RETURNING id`,
    fields.map((f) => (shown(f, values) ? values[f.name] : null)),
  );
  return row.rows[0].id;
}

export async function updateRow(entity, id, values) {
  const types = await columnTypes(entity.table);
  const dup = await checkUnique(entity, values, id);
  if (dup) {
    const rule = entity.unique.find((r) => r.cols.join() === dup.join());
    const field = dup[0];
    const label = rule.labels[field] || field;
    const err = new Error("duplicado");
    err.validationError = { field, message: `Já existe outro registro com ${label} igual a "${values[field]}".` };
    throw err;
  }

  const fields = entity.fields;
  const sets = fields.map((f, i) => {
    const v = shown(f, values) ? values[f.name] : null;
    const cast = v === null || v === undefined ? "" : castFor(types[f.name], v);
    return `${f.name} = $${i + 1}${cast}`;
  });
  const params = fields.map((f) => (shown(f, values) ? values[f.name] : null));
  params.push(id);

  const res = await query(
    `UPDATE ${entity.table} SET ${sets.join(", ")} WHERE id = $${params.length}::uuid RETURNING id`,
    params,
  );
  if (!res.rows.length) {
    const err = new Error("registro não encontrado");
    err.notFound = true;
    throw err;
  }

  if (entity.afterUpdate) {
    await entity.afterUpdate({ query, id });
  }
  return res.rows[0].id;
}

export async function deleteRow(entity, id) {
  const res = await query(`DELETE FROM ${entity.table} WHERE id = $1::uuid RETURNING id`, [id]);
  if (!res.rows.length) {
    const err = new Error("registro não encontrado");
    err.notFound = true;
    throw err;
  }
}

export async function deleteImpact(entity, id) {
  const items = [];
  for (const rule of entity.onDelete || []) {
    const { rows } = await query(rule.sql, [id]);
    items.push({ label: rule.label, behavior: rule.behavior, count: rows[0]?.n ?? 0 });
  }
  return items;
}

export { PAGE_SIZE };
