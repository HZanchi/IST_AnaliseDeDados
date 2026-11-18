const PT = "pt-BR";
const TZ = "America/Sao_Paulo";

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Relatório (PRO-5 §3): `DD/MM/YYYY HH:MM` em America/Sao_Paulo. */
export function formatDateTimeBR(value) {
  const base = formatDateTime(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?: (.*))?$/.exec(base);
  if (!match) return base;
  const [, year, month, day, time] = match;
  return `${day}/${month}/${year}${time ? ` ${time}` : ""}`;
}

/** Relatório (PRO-5 §3): `DD/MM/YYYY` em America/Sao_Paulo. */
export function formatDateBR(value) {
  return formatDateTimeBR(value).split(" ")[0];
}

export function formatNumber(value, { maxDigits = 3 } = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(PT, { maximumFractionDigits: maxDigits });
}

export function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `${n.toLocaleString(PT, { maximumFractionDigits: 1 })}%`;
}

export const VERDICT_LABEL = {
  compliant: "Conforme",
  non_compliant: "Não conforme",
  indeterminate: "Indeterminado",
  not_evaluated: "Não avaliado",
  no_limit: "Sem limite aplicável",
  empty: "Sem resultados",
};

export const VERDICT_KIND = {
  compliant: "ok",
  non_compliant: "bad",
  indeterminate: "warn",
  not_evaluated: "warn",
  no_limit: "neutral",
  empty: "neutral",
};

export const MATRIX_LABEL = {
  surface: "Água superficial",
  ground: "Água subterrânea",
  tap: "Água tratada/consumo",
  effluent: "Efluentes",
  marine: "Água marinha",
  precipitation: "Precipitação",
  other: "Outra",
  any: "Todas as matrizes (deliberado)",
};

export const SAMPLE_STATUS_LABEL = {
  collected: "Coletada",
  in_transit: "Em trânsito",
  received: "Recebida",
  analysing: "Em análise",
  reported: "Laudo emitido",
  void: "Anulada",
};

export const LIMIT_KIND_LABEL = {
  max: "máximo",
  min: "mínimo",
  range: "faixa",
  text: "textual",
};

export const LIMIT_TIER_LABEL = {
  maximum: "Limite máximo",
  aesthetic: "Estético",
  action_level: "Nível de ação",
  treatment_technique: "Técnica de tratamento",
  guideline: "Diretriz",
};

export const BASIS_LABEL = {
  single_sample: "amostra individual",
  running_average: "média móvel",
  periodic_average: "média periódica",
  frequency: "frequência",
};

export const CONVERSION_LABEL = {
  exact: "exata",
  converted: "convertida",
  ambiguous: "ambígua",
  not_applicable: "n/a",
};

export function verdictLabel(verdict) {
  return VERDICT_LABEL[verdict] || verdict || "—";
}

export function verdictKind(verdict) {
  return VERDICT_KIND[verdict] || "neutral";
}

export function matrixLabel(matrix) {
  return MATRIX_LABEL[matrix] || matrix || "—";
}

export function sampleStatusLabel(status) {
  return SAMPLE_STATUS_LABEL[status] || status || "—";
}

export function limitKindLabel(kind) {
  return LIMIT_KIND_LABEL[kind] || kind || "—";
}

export function conversionLabel(status) {
  return CONVERSION_LABEL[status] || status || "—";
}

export function limitTierLabel(tier) {
  return LIMIT_TIER_LABEL[tier] || tier || "—";
}

export function basisLabel(basis) {
  return BASIS_LABEL[basis] || basis || "—";
}

/**
 * Canonical numeric value still NULL while the law published one?
 * Happens for `conversion_status = 'ambiguous'` rows (e.g. NMP vs CFU) —
 * the published form is authoritative until a human resolves it.
 */
export function canonicalMissing(limit) {
  if (!limit || limit.limit_kind === "text") return false;
  const hasCanonical =
    limit.limit_value !== null && limit.limit_value !== undefined
      ? true
      : limit.limit_lower !== null && limit.limit_lower !== undefined;
  return !hasCanonical;
}

/** Renders a limit as a human sentence fragment, e.g. "≤ 0,3 mg/L". */
export function limitPhrase(limit) {
  if (!limit) return "—";
  const pending = canonicalMissing(limit);
  const value = pending ? limit.published_value : limit.limit_value;
  const lower = pending ? limit.published_lower : limit.limit_lower;
  const upper = pending ? limit.published_upper : limit.limit_upper;
  const unitSrc = pending ? limit.published_unit : limit.unit;
  const unit = unitSrc ? ` ${unitSrc}` : "";
  const suffix = pending ? " · canônico pendente" : "";
  switch (limit.limit_kind) {
    case "max":
      return `≤ ${formatNumber(value)}${unit}${suffix}`;
    case "min":
      return `≥ ${formatNumber(value)}${unit}${suffix}`;
    case "range":
      return `${formatNumber(lower)} – ${formatNumber(upper)}${unit}${suffix}`;
    case "text":
      return limit.limit_text || "—";
    default:
      return "—";
  }
}

/** Same as limitPhrase but using the values exactly as the law published them. */
export function publishedLimitPhrase(limit) {
  if (!limit) return "—";
  const unit = limit.published_unit ? ` ${limit.published_unit}` : "";
  switch (limit.limit_kind) {
    case "max":
      return `≤ ${formatNumber(limit.published_value)}${unit}`;
    case "min":
      return `≥ ${formatNumber(limit.published_value)}${unit}`;
    case "range":
      return `${formatNumber(limit.published_lower)} – ${formatNumber(limit.published_upper)}${unit}`;
    case "text":
      return limit.limit_text || "—";
    default:
      return "—";
  }
}

export function resultPhrase(result) {
  if (!result) return "—";
  if (result.value_numeric !== null && result.value_numeric !== undefined) {
    const censor =
      result.censored === "below_dl"
        ? "< "
        : result.censored === "above_ul"
          ? "> "
          : result.censored === "not_detected"
            ? "ND "
            : "";
    const unit = result.unit ? ` ${result.unit}` : "";
    return `${censor}${formatNumber(result.value_numeric)}${unit}`;
  }
  if (result.value_text) return String(result.value_text);
  return "—";
}
