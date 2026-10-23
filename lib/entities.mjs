import { escapeHtml } from "./html.mjs";
import {
  formatDate,
  formatDateTime,
  matrixLabel,
  sampleStatusLabel,
  limitKindLabel,
  conversionLabel,
  LIMIT_TIER_LABEL,
  BASIS_LABEL,
} from "./format.mjs";

export const MATRIX_OPTIONS = [
  ["surface", "Água superficial"],
  ["ground", "Água subterrânea"],
  ["tap", "Água tratada/consumo"],
  ["effluent", "Efluentes"],
  ["marine", "Água marinha"],
  ["precipitation", "Precipitação"],
  ["other", "Outra"],
];

export const SOURCE_TYPE_OPTIONS = [
  ["surface", "Superfície"],
  ["ground", "Subterrânea"],
  ["treated_distribution", "Tratada / distribuição"],
  ["tap", "Torneira"],
  ["effluent", "Efluentes"],
  ["marine", "Marinha"],
  ["rainfall", "Precipitação"],
  ["other", "Outra"],
];

export const SAMPLE_STATUS_OPTIONS = [
  ["collected", "Coletada"],
  ["in_transit", "Em trânsito"],
  ["received", "Recebida"],
  ["analysing", "Em análise"],
  ["reported", "Laudo emitido"],
  ["void", "Anulada"],
];

export const PARAMETER_CATEGORY_OPTIONS = [
  ["physical", "Físico"],
  ["chemical", "Químico"],
  ["microbiological", "Microbiológico"],
  ["radiological", "Radiológico"],
  ["toxicological", "Tóxico"],
  ["emerging", "Emergentes"],
  ["other", "Outro"],
];

export const DATA_TYPE_OPTIONS = [
  ["numeric", "Numérico"],
  ["text", "Texto"],
];

export const DATA_STATUS_OPTIONS = [
  ["preliminary", "Preliminar"],
  ["final", "Final"],
  ["amended", "Retificado"],
  ["rejected", "Rejeitado"],
];

export const CENSORED_OPTIONS = [
  ["", "— não aplicável —"],
  ["below_dl", "Abaixo do limite de detecção (below_dl)"],
  ["above_ul", "Acima do limite de quantificação (above_ul)"],
  ["trace", "Traços (trace)"],
  ["not_detected", "Não detectado (not_detected)"],
];

export const LIMIT_KIND_OPTIONS = [
  ["max", "Máximo (≤)"],
  ["min", "Mínimo (≥)"],
  ["range", "Faixa (min–max)"],
  ["text", "Textual"],
];

export const LIMIT_TIER_OPTIONS = Object.entries(LIMIT_TIER_LABEL);

export const BASIS_OPTIONS = Object.entries(BASIS_LABEL);

export const CONVERSION_OPTIONS = [
  ["exact", "Exata (sem conversão)"],
  ["converted", "Convertida para unidade canônica"],
  ["ambiguous", "Ambígua (canônico pendente)"],
  ["not_applicable", "Não aplicável"],
];

export const LIMIT_SCOPE_OPTIONS = [
  ["any", "Todas as matrizes (deliberado)"],
  ...MATRIX_OPTIONS,
];

function e(field, message) {
  return { field, message };
}

function required(values, name, label, errors) {
  const v = values[name];
  if (v === null || v === undefined || v === "") {
    errors.push(e(name, `${label} é um campo obrigatório.`));
    return false;
  }
  return true;
}

function numberRange(values, name, label, errors, { min, max } = {}) {
  const v = values[name];
  if (v === null || v === undefined) return;
  if (Number.isNaN(v)) {
    errors.push(e(name, `${label} precisa ser um número válido.`));
    return;
  }
  if (min !== undefined && v < min) {
    errors.push(e(name, `${label} não pode ser menor que ${min}.`));
  }
  if (max !== undefined && v > max) {
    errors.push(e(name, `${label} não pode ser maior que ${max}.`));
  }
}

/** a deve ser >= b: acusa erro quando a é anterior a b (ex.: recebida antes da coleta). */
function dateOrder(aLabel, aValue, bLabel, bValue, errors, aField, bField) {
  if (!aValue || !bValue) return;
  if (new Date(aValue).getTime() < new Date(bValue).getTime()) {
    errors.push(e(aField, `${aLabel} não pode ser anterior a ${bLabel}.`));
  }
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && ID_RE.test(value);
}

export const ENTITIES = {
  pontos: {
    table: "sampling_points",
    title: "Pontos de coleta",
    singular: "Ponto de coleta",
    description: "Onde as amostras são coletadas (alvo de FK de toda amostra).",
    unique: [{ cols: ["code"], labels: { code: "Código" } }],
    fields: [
      { name: "code", label: "Código", type: "text", required: true, help: "Identificador único, ex.: PT-RIO-01." },
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "source_type", label: "Tipo de fonte", type: "select", required: true, options: SOURCE_TYPE_OPTIONS },
      { name: "description", label: "Descrição", type: "textarea" },
      { name: "water_body", label: "Corpo d'água", type: "text" },
      { name: "region", label: "Região", type: "text" },
      { name: "address", label: "Endereço", type: "text" },
      { name: "latitude", label: "Latitude", type: "number", step: "any", min: -90, max: 90 },
      { name: "longitude", label: "Longitude", type: "number", step: "any", min: -180, max: 180 },
      { name: "elevation_m", label: "Elevação (m)", type: "number", step: "any" },
      { name: "active", label: "Ativo", type: "checkbox", help: "Desmarcado = ponto fora de uso." },
    ],
    defaults: { source_type: "surface", active: true },
    list: {
      order: "code",
      search: ["code", "name", "water_body", "region"],
      columns: [
        { label: "Código", render: (r) => `<code>${escapeHtml(r.code)}</code>` },
        { label: "Nome", render: (r) => escapeHtml(r.name) },
        { label: "Tipo", render: (r) => escapeHtml(r.source_type) },
        { label: "Corpo d'água", render: (r) => escapeHtml(r.water_body || "—") },
        { label: "Região", render: (r) => escapeHtml(r.region || "—") },
        { label: "Ativo", render: (r) => (r.active ? "sim" : "não") },
      ],
    },
    validate: (values) => {
      const errors = [];
      numberRange(values, "latitude", "Latitude", errors, { min: -90, max: 90 });
      numberRange(values, "longitude", "Longitude", errors, { min: -180, max: 180 });
      return errors;
    },
    onDelete: [
      { label: "amostras que usam este ponto", behavior: "restrict", sql: "SELECT count(*)::int AS n FROM samples WHERE sampling_point_id = $1" },
    ],
  },

  amostras: {
    table: "samples",
    title: "Amostras",
    singular: "Amostra",
    description: "Coletas físicas vinculadas a um ponto; hospedam os resultados.",
    unique: [{ cols: ["code"], labels: { code: "Código" } }],
    fields: [
      {
        name: "sampling_point_id",
        label: "Ponto de coleta",
        type: "select",
        required: true,
        options: { sql: "SELECT id::text AS value, code || ' — ' || name AS label FROM sampling_points ORDER BY code LIMIT 2000" },
      },
      { name: "code", label: "Código da amostra", type: "text", required: true, help: "Identificador único, ex.: AM-2026-001." },
      { name: "collected_at", label: "Coletada em", type: "datetime", required: true },
      { name: "matrix", label: "Matriz", type: "select", required: true, options: MATRIX_OPTIONS },
      { name: "status", label: "Status", type: "select", required: true, options: SAMPLE_STATUS_OPTIONS },
      { name: "received_at", label: "Recebida em", type: "datetime", help: "Opcional; não pode ser anterior à coleta." },
      { name: "depth_m", label: "Profundidade (m)", type: "number", step: "any", min: 0 },
      { name: "temperature_c", label: "Temperatura no campo (°C)", type: "number", step: "any", min: -20, max: 100 },
      { name: "volume_l", label: "Volume coletado (L)", type: "number", step: "any", min: 0, exclusiveMin: true },
      { name: "collected_by", label: "Coletada por", type: "text" },
      { name: "field_notes", label: "Observações de campo", type: "textarea" },
    ],
    defaults: { matrix: "surface", status: "collected" },
    list: {
      order: "collected_at DESC",
      search: ["code", "collected_by", "field_notes"],
      columns: [
        { label: "Código", render: (r) => `<a href="/amostras/${encodeURIComponent(r.code)}"><code>${escapeHtml(r.code)}</code></a>` },
        { label: "Ponto", render: (r) => escapeHtml(r.point_label || r.sampling_point_id) },
        { label: "Coleta", render: (r) => formatDateTime(r.collected_at) },
        { label: "Matriz", render: (r) => matrixLabel(r.matrix) },
        { label: "Status", render: (r) => sampleStatusLabel(r.status) },
        { label: "Resultados", render: (r) => String(r.result_count ?? "—") },
      ],
      sql: `SELECT s.*, sp.code || ' — ' || sp.name AS point_label,
                   (SELECT count(*)::int FROM results x WHERE x.sample_id = s.id) AS result_count
              FROM samples s JOIN sampling_points sp ON sp.id = s.sampling_point_id`,
    },
    validate: (values) => {
      const errors = [];
            numberRange(values, "depth_m", "Profundidade", errors, { min: 0 });
      numberRange(values, "temperature_c", "Temperatura", errors, { min: -20, max: 100 });
      if (values.volume_l !== null && values.volume_l !== undefined && values.volume_l <= 0) {
        errors.push(e("volume_l", "Volume coletado precisa ser maior que zero."));
      }
      dateOrder("Recebida em", values.received_at, "coleta", values.collected_at, errors, "received_at", "collected_at");
      return errors;
    },
    onDelete: [
      { label: "resultados desta amostra", behavior: "cascade", sql: "SELECT count(*)::int AS n FROM results WHERE sample_id = $1" },
      { label: "vereditos dos resultados desta amostra", behavior: "cascade", sql: "SELECT count(*)::int AS n FROM compliance_verdicts cv JOIN results r ON r.id = cv.result_id WHERE r.sample_id = $1" },
    ],
  },

  parametros: {
    table: "test_parameters",
    title: "Parâmetros de ensaio",
    singular: "Parâmetro",
    description: "O que é medido (pH, turbidade, coliformes…); alvo de FK de resultados e limites.",
    unique: [{ cols: ["code"], labels: { code: "Código" } }],
    fields: [
      { name: "code", label: "Código", type: "text", required: true, help: "Identificador único, ex.: ph." },
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "category", label: "Categoria", type: "select", required: true, options: PARAMETER_CATEGORY_OPTIONS },
      { name: "data_type", label: "Tipo de dado", type: "select", required: true, options: DATA_TYPE_OPTIONS },
      { name: "unit", label: "Unidade", type: "text", help: "Obrigatória para parâmetros numéricos; proibida para texto." },
      { name: "synonyms", label: "Sinônimos", type: "csv", help: "Separados por vírgula (vira um array no banco)." },
      { name: "method_reference", label: "Referência do método", type: "text" },
      { name: "method_code", label: "Código do método", type: "text" },
      { name: "detection_limit", label: "Limite de detecção (LD)", type: "number", step: "any", min: 0 },
      { name: "reporting_limit", label: "Limite de relato (LR)", type: "number", step: "any", min: 0 },
      { name: "ideal_range_lower", label: "Faixa ideal — inferior", type: "number", step: "any" },
      { name: "ideal_range_upper", label: "Faixa ideal — superior", type: "number", step: "any" },
      { name: "description", label: "Descrição", type: "textarea" },
      { name: "sort_order", label: "Ordem", type: "integer", help: "Usado para ordenação nos catálogos." },
      { name: "active", label: "Ativo", type: "checkbox" },
    ],
    defaults: { category: "chemical", data_type: "numeric", sort_order: 0, active: true },
    list: {
      order: "sort_order, code",
      search: ["code", "name", "method_reference", "method_code"],
      columns: [
        { label: "Código", render: (r) => `<code>${escapeHtml(r.code)}</code>` },
        { label: "Nome", render: (r) => escapeHtml(r.name) },
        { label: "Categoria", render: (r) => escapeHtml(r.category) },
        { label: "Tipo", render: (r) => escapeHtml(r.data_type) },
        { label: "Unidade", render: (r) => escapeHtml(r.unit || "—") },
        { label: "Resultados", render: (r) => String(r.result_count ?? "—") },
        { label: "Limites", render: (r) => String(r.limit_count ?? "—") },
      ],
      sql: `SELECT tp.*,
                   (SELECT count(*)::int FROM results x WHERE x.parameter_id = tp.id) AS result_count,
                   (SELECT count(*)::int FROM legislation_limits x WHERE x.parameter_id = tp.id) AS limit_count
              FROM test_parameters tp`,
    },
    validate: (values) => {
      const errors = [];
      if (values.data_type === "numeric" && !values.unit) {
        errors.push(e("unit", "Parâmetro numérico precisa de unidade (ex.: mg/L, NTU)."));
      }
      if (values.data_type === "text" && values.unit) {
        errors.push(e("unit", "Parâmetro de texto não pode ter unidade (regra do banco)."));
      }
      if (values.detection_limit !== null && values.detection_limit !== undefined &&
          values.reporting_limit !== null && values.reporting_limit !== undefined &&
          values.detection_limit > values.reporting_limit) {
        errors.push(e("detection_limit", "O limite de detecção não pode ser maior que o limite de relato."));
      }
      if (values.ideal_range_lower !== null && values.ideal_range_lower !== undefined &&
          values.ideal_range_upper !== null && values.ideal_range_upper !== undefined &&
          values.ideal_range_lower > values.ideal_range_upper) {
        errors.push(e("ideal_range_lower", "A faixa ideal inferior não pode ser maior que a superior."));
      }
      return errors;
    },
    onDelete: [
      { label: "resultados que usam este parâmetro", behavior: "restrict", sql: "SELECT count(*)::int AS n FROM results WHERE parameter_id = $1" },
      { label: "limites que usam este parâmetro", behavior: "restrict", sql: "SELECT count(*)::int AS n FROM legislation_limits WHERE parameter_id = $1" },
    ],
  },

  resultados: {
    table: "results",
    title: "Resultados",
    singular: "Resultado",
    description: "O valor medido em uma amostra para um parâmetro (a linha que gera veredito).",
    unique: [{ cols: ["sample_id", "parameter_id", "replicate"], labels: { replicate: "Réplica" } }],
    fields: [
      {
        name: "sample_id",
        label: "Amostra",
        type: "select",
        required: true,
        options: { sql: "SELECT id::text AS value, code || ' — ' || to_char(collected_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS label FROM samples ORDER BY collected_at DESC LIMIT 2000" },
      },
      {
        name: "parameter_id",
        label: "Parâmetro",
        type: "select",
        required: true,
        options: { sql: "SELECT id::text AS value, code || ' — ' || name AS label FROM test_parameters ORDER BY sort_order, code LIMIT 2000" },
      },
      { name: "replicate", label: "Réplica", type: "integer", required: true, min: 1, help: "1 = primeira leitura; aumente para repetições." },
      { name: "value_numeric", label: "Valor numérico", type: "number", step: "any", help: "Obrigatório para parâmetros numéricos." },
      { name: "value_text", label: "Valor textual", type: "text", help: "Obrigatório para parâmetros de texto." },
      { name: "unit", label: "Unidade", type: "text" },
      { name: "detection_limit", label: "Limite de detecção (LD)", type: "number", step: "any", min: 0 },
      { name: "quantification_limit", label: "Limite de quantificação (LQ)", type: "number", step: "any", min: 0 },
      { name: "censored", label: "Valor censurado", type: "select", options: CENSORED_OPTIONS, help: "Ex.: resultado abaixo do LD." },
      { name: "data_status", label: "Status do dado", type: "select", required: true, options: DATA_STATUS_OPTIONS },
      { name: "measured_at", label: "Medido em", type: "datetime" },
      { name: "reported_at", label: "Laudo em", type: "datetime" },
      { name: "method_code", label: "Método", type: "text" },
      { name: "laboratory", label: "Laboratório", type: "text" },
      { name: "analyst", label: "Analista", type: "text" },
      { name: "notes", label: "Observações", type: "textarea" },
    ],
    defaults: { replicate: 1, data_status: "final", censored: "" },
    list: {
      order: "measured_at DESC NULLS LAST, created_at DESC",
      search: ["value_text", "laboratory", "analyst", "method_code"],
      columns: [
        { label: "Amostra", render: (r) => `<a href="/amostras/${encodeURIComponent(r.sample_code)}"><code>${escapeHtml(r.sample_code)}</code></a>` },
        { label: "Parâmetro", render: (r) => `${escapeHtml(r.parameter_name)}<br><span class="muted"><code>${escapeHtml(r.parameter_code)}</code></span>` },
        { label: "Valor", render: (r) => (r.value_numeric !== null && r.value_numeric !== undefined ? `${escapeHtml(r.value_numeric)}${r.unit ? ` ${escapeHtml(r.unit)}` : ""}` : escapeHtml(r.value_text || "—")) },
        { label: "Réplica", render: (r) => String(r.replicate) },
        { label: "Status", render: (r) => escapeHtml(r.data_status) },
        { label: "Medido em", render: (r) => formatDateTime(r.measured_at) },
        { label: "Laboratório", render: (r) => escapeHtml(r.laboratory || "—") },
        { label: "Veredito", render: (r) => escapeHtml(r.verdict || "—") },
      ],
      sql: `SELECT r.*, s.code AS sample_code, tp.code AS parameter_code, tp.name AS parameter_name,
                   (SELECT verdict FROM compliance_verdicts cv
                     WHERE cv.result_id = r.id AND cv.superseded_at IS NULL
                     ORDER BY cv.evaluated_at DESC LIMIT 1) AS verdict
              FROM results r
              JOIN samples s ON s.id = r.sample_id
              JOIN test_parameters tp ON tp.id = r.parameter_id`,
    },
    validate: async (values, { query }) => {
      const errors = [];
      if (values.replicate === null || values.replicate === undefined) {
        errors.push(e("replicate", "Réplica é obrigatória."));
      } else if (values.replicate < 1) {
        errors.push(e("replicate", "Réplica começa em 1."));
      }

      if (values.parameter_id) {
        const { rows } = await query(
          "SELECT code, data_type, unit FROM test_parameters WHERE id = $1",
          [values.parameter_id],
        );
        const param = rows[0];
        if (param) {
          if (param.data_type === "numeric") {
            if (values.value_numeric === null || values.value_numeric === undefined) {
              errors.push(e("value_numeric", `Parâmetro numérico exige valor numérico (${param.code}).`));
            }
          } else if (!values.value_text) {
            errors.push(e("value_text", `Parâmetro de texto exige valor textual (${param.code}).`));
          }
          if (param.data_type !== "numeric" && values.unit) {
            errors.push(e("unit", "Parâmetro de texto não leva unidade."));
          }
        }
      }

      if (values.value_numeric === null && !values.value_text &&
          !errors.some((x) => x.field === "value_numeric" || x.field === "value_text")) {
        errors.push(e("value_numeric", "Informe ao menos um valor (numérico ou textual)."));
      }
      if (values.censored && (values.value_numeric === null || values.value_numeric === undefined)) {
        errors.push(e("censored", "Valor censurado só se aplica a resultado numérico."));
      }
      if (values.value_numeric !== null && values.value_numeric !== undefined &&
          values.detection_limit !== null && values.detection_limit !== undefined &&
          values.detection_limit > values.value_numeric) {
        errors.push(e("detection_limit", "O LD não pode ser maior que o valor medido."));
      }
      dateOrder("Laudo", values.reported_at, "medida", values.measured_at, errors, "reported_at", "measured_at");
      return errors;
    },
    afterUpdate: async ({ query, id }) => {
      await query(
        `UPDATE compliance_verdicts
            SET superseded_at = now(),
                notes = coalesce(notes || E'\n', '') || 'Veredito aposentado: resultado editado pelo CRUD em ' || now()::text
          WHERE result_id = $1 AND superseded_at IS NULL`,
        [id],
      );
    },
    onDelete: [
      { label: "vereditos calculados a partir deste resultado", behavior: "cascade", sql: "SELECT count(*)::int AS n FROM compliance_verdicts WHERE result_id = $1" },
    ],
  },

  leis: {
    table: "legislations",
    title: "Legislações",
    singular: "Legislação",
    description: "Onde nasce o limite (CONAMA, WHO, EU, EPA…); alvo de FK dos limites.",
    unique: [{ cols: ["code"], labels: { code: "Código" } }],
    fields: [
      { name: "code", label: "Código", type: "text", required: true, help: "Ex.: CONAMA-357-2005." },
      { name: "short_name", label: "Nome curto", type: "text", required: true },
      { name: "name", label: "Nome completo", type: "text", required: true },
      { name: "issuing_body", label: "Órgão emissor", type: "text", required: true },
      { name: "jurisdiction", label: "Jurisdição", type: "text" },
      { name: "document_reference", label: "Referência do documento", type: "text" },
      { name: "publication_date", label: "Data de publicação", type: "date" },
      { name: "effective_from", label: "Vigência de", type: "date" },
      { name: "effective_to", label: "Vigência até", type: "date" },
      { name: "applies_to_matrix", label: "Matriz aplicável", type: "select", options: [["", "— qualquer —"], ...MATRIX_OPTIONS] },
      { name: "source_url", label: "URL da fonte", type: "text" },
      { name: "description", label: "Descrição", type: "textarea" },
    ],
    defaults: {},
    list: {
      order: "code",
      search: ["code", "short_name", "name", "issuing_body"],
      columns: [
        { label: "Código", render: (r) => `<code>${escapeHtml(r.code)}</code>` },
        { label: "Nome curto", render: (r) => escapeHtml(r.short_name) },
        { label: "Órgão", render: (r) => escapeHtml(r.issuing_body) },
        { label: "Vigência", render: (r) => `${formatDate(r.effective_from) || "—"} → ${formatDate(r.effective_to) || "—"}` },
        { label: "Limites", render: (r) => String(r.limit_count ?? "—") },
      ],
      sql: `SELECT l.*,
                   (SELECT count(*)::int FROM legislation_limits x WHERE x.legislation_id = l.id) AS limit_count
              FROM legislations l`,
    },
    validate: (values) => {
      const errors = [];
      dateOrder("Vigência até", values.effective_to, "vigência de", values.effective_from, errors, "effective_to", "effective_from");
      return errors;
    },
    onDelete: [
      { label: "limites desta legislação", behavior: "restrict", sql: "SELECT count(*)::int AS n FROM legislation_limits WHERE legislation_id = $1" },
    ],
  },

  limites: {
    table: "legislation_limits",
    title: "Limites por legislação",
    singular: "Limite",
    description: "Quanto vale o limite para um parâmetro numa legislação (valor publicado × canônico).",
    unique: [
      { cols: ["legislation_id", "parameter_id", "limit_kind", "limit_tier"], labels: { limit_kind: "Tipo de limite", limit_tier: "Nível" } },
    ],
    fields: [
      {
        name: "legislation_id",
        label: "Legislação",
        type: "select",
        required: true,
        options: { sql: "SELECT id::text AS value, code || ' — ' || short_name AS label FROM legislations ORDER BY code LIMIT 2000" },
      },
      {
        name: "parameter_id",
        label: "Parâmetro",
        type: "select",
        required: true,
        options: { sql: "SELECT id::text AS value, code || ' — ' || name AS label FROM test_parameters ORDER BY sort_order, code LIMIT 2000" },
      },
      { name: "limit_kind", label: "Tipo de limite", type: "select", required: true, options: LIMIT_KIND_OPTIONS },
      { name: "limit_tier", label: "Nível", type: "select", required: true, options: LIMIT_TIER_OPTIONS },
      { name: "basis", label: "Base de avaliação", type: "select", required: true, options: BASIS_OPTIONS },
      { name: "limit_value", label: "Valor canônico", type: "number", step: "any", showIf: (v) => v.limit_kind === "max" || v.limit_kind === "min", help: "Unidade canônica normalizada; deixe vazio se a conversão for ambígua." },
      { name: "limit_lower", label: "Canônico — inferior", type: "number", step: "any", showIf: (v) => v.limit_kind === "range" },
      { name: "limit_upper", label: "Canônico — superior", type: "number", step: "any", showIf: (v) => v.limit_kind === "range" },
      { name: "limit_text", label: "Texto do limite", type: "text", showIf: (v) => v.limit_kind === "text" },
      { name: "unit", label: "Unidade canônica", type: "text", showIf: (v) => v.limit_kind !== "text" },
      { name: "published_value", label: "Valor publicado", type: "number", step: "any", showIf: (v) => v.limit_kind === "max" || v.limit_kind === "min", help: "Exatamente como a lei publica (ex.: NMP/100 mL)." },
      { name: "published_lower", label: "Publicado — inferior", type: "number", step: "any", showIf: (v) => v.limit_kind === "range" },
      { name: "published_upper", label: "Publicado — superior", type: "number", step: "any", showIf: (v) => v.limit_kind === "range" },
      { name: "published_unit", label: "Unidade publicada", type: "text", showIf: (v) => v.limit_kind !== "text" },
      { name: "conversion_status", label: "Status da conversão", type: "select", required: true, options: CONVERSION_OPTIONS },
      { name: "conversion_note", label: "Nota da conversão", type: "textarea", showIf: (v) => v.conversion_status === "converted" || v.conversion_status === "ambiguous", help: "Obrigatória para conversão convertida ou ambígua." },
      { name: "applies_to_matrix", label: "Matriz aplicável", type: "select", required: true, options: LIMIT_SCOPE_OPTIONS, help: "NOT NULL desde 0005_matrix_scope.sql (PRO-13): todo limite declara escopo. \"Todas as matrizes\" é escolha deliberada ('any'), nunca uma omissão." },
      { name: "assessment_window", label: "Janela de avaliação", type: "text" },
      { name: "max_non_compliance_count", label: "Máx. de amostras não conformes", type: "integer", min: 0 },
      { name: "max_non_compliance_rate", label: "Máx. taxa de não conformidade (0–1)", type: "number", step: "any", min: 0, max: 1 },
      { name: "citation", label: "Citação / trecho da lei", type: "textarea" },
      { name: "effective_from", label: "Vigência de", type: "date" },
      { name: "effective_to", label: "Vigência até", type: "date" },
      { name: "notes", label: "Observações", type: "textarea" },
    ],
    defaults: { limit_kind: "max", limit_tier: "maximum", basis: "single_sample", conversion_status: "exact" },
    list: {
      order: "law_code, param_sort_order, parameter_code",
      search: ["citation", "notes", "unit", "published_unit"],
      columns: [
        { label: "Legislação", render: (r) => `<code>${escapeHtml(r.law_code)}</code>` },
        { label: "Parâmetro", render: (r) => `${escapeHtml(r.parameter_name)}<br><span class="muted"><code>${escapeHtml(r.parameter_code)}</code></span>` },
        { label: "Tipo", render: (r) => escapeHtml(limitKindLabel(r.limit_kind)) },
        { label: "Publicado", render: (r) => `${r.published_value !== null && r.published_value !== undefined ? escapeHtml(r.published_value) : `${escapeHtml(r.published_lower ?? "—")} – ${escapeHtml(r.published_upper ?? "—")}`}${r.published_unit ? ` ${escapeHtml(r.published_unit)}` : ""}` },
        { label: "Canônico", render: (r) => (r.conversion_status === "ambiguous" ? `<span class="muted">pendente (ambígua)</span>` : `${r.limit_value !== null && r.limit_value !== undefined ? escapeHtml(r.limit_value) : `${escapeHtml(r.limit_lower ?? "—")} – ${escapeHtml(r.limit_upper ?? "—")}`}${r.unit ? ` ${escapeHtml(r.unit)}` : ""}`) },
        { label: "Conversão", render: (r) => escapeHtml(conversionLabel(r.conversion_status)) },
        { label: "Matriz", render: (r) => (r.applies_to_matrix ? matrixLabel(r.applies_to_matrix) : "—") },
      ],
      sql: `SELECT ll.*, l.code AS law_code, tp.code AS parameter_code, tp.name AS parameter_name,
                   tp.sort_order AS param_sort_order
              FROM legislation_limits ll
              JOIN legislations l ON l.id = ll.legislation_id
              JOIN test_parameters tp ON tp.id = ll.parameter_id`,
    },
    validate: (values) => {
      const errors = [];
      const kind = values.limit_kind;
      const ambiguous = values.conversion_status === "ambiguous";

      if (values.conversion_status === "converted" || ambiguous) {
        required(values, "conversion_note", "Nota da conversão", errors);
      }
      if (ambiguous && (values.limit_value !== null || values.limit_lower !== null || values.limit_upper !== null)) {
        errors.push(e("limit_value", "Conversão ambígua exige valor canônico vazio (a coluna fica nula até a decisão humana)."));
      }

      if (kind === "text") {
        required(values, "limit_text", "Texto do limite", errors);
        if (values.unit || values.published_unit || values.limit_value !== null || values.published_value !== null) {
          errors.push(e("limit_text", "Limite textual não aceita valores nem unidades."));
        }
      } else {
        required(values, "unit", "Unidade canônica", errors);
        required(values, "published_unit", "Unidade publicada", errors);
        if (kind === "max" || kind === "min") {
          required(values, "published_value", "Valor publicado", errors);
          if (!ambiguous) required(values, "limit_value", "Valor canônico", errors);
          if (values.limit_lower !== null || values.limit_upper !== null || values.published_lower !== null || values.published_upper !== null) {
            errors.push(e("limit_value", "Tipo máximo/mínimo não aceita faixa."));
          }
        } else if (kind === "range") {
          required(values, "published_lower", "Publicado — inferior", errors);
          required(values, "published_upper", "Publicado — superior", errors);
          if (!ambiguous) {
            required(values, "limit_lower", "Canônico — inferior", errors);
            required(values, "limit_upper", "Canônico — superior", errors);
          }
          if (values.published_lower !== null && values.published_upper !== null && values.published_lower > values.published_upper) {
            errors.push(e("published_lower", "O valor publicado inferior não pode ser maior que o superior."));
          }
          if (values.limit_lower !== null && values.limit_upper !== null && values.limit_lower > values.limit_upper) {
            errors.push(e("limit_lower", "O canônico inferior não pode ser maior que o superior."));
          }
          if (values.limit_value !== null || values.published_value !== null) {
            errors.push(e("limit_lower", "Tipo faixa não aceita valor único."));
          }
        }
      }

      if (values.max_non_compliance_rate !== null && values.max_non_compliance_rate !== undefined) {
        if (values.max_non_compliance_rate < 0 || values.max_non_compliance_rate > 1) {
          errors.push(e("max_non_compliance_rate", "A taxa deve ficar entre 0 e 1."));
        }
      }
      dateOrder("Vigência até", values.effective_to, "vigência de", values.effective_from, errors, "effective_to", "effective_from");
      return errors;
    },
    afterUpdate: async ({ query, id }) => {
      await query(
        `UPDATE compliance_verdicts
            SET superseded_at = now(),
                notes = coalesce(notes || E'\n', '') || 'Veredito aposentado: limite editado pelo CRUD em ' || now()::text
          WHERE legislation_limit_id = $1 AND superseded_at IS NULL`,
        [id],
      );
    },
    onDelete: [
      { label: "vereditos que citam este limite", behavior: "restrict", sql: "SELECT count(*)::int AS n FROM compliance_verdicts WHERE legislation_limit_id = $1" },
    ],
  },
};

export const ENTITY_ORDER = ["pontos", "amostras", "parametros", "resultados", "leis", "limites"];

export function getEntity(key) {
  return ENTITIES[key] || null;
}
