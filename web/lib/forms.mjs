import { escapeHtml } from "./html.mjs";

function valueOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function fieldError(errors, name) {
  const hit = (errors || []).find((x) => x.field === name);
  return hit ? `<p class="field-error">${escapeHtml(hit.message)}</p>` : "";
}

function fieldClass(field, errors) {
  const has = (errors || []).some((x) => x.field === field.name);
  return `field${has ? " field-invalid" : ""}`;
}

function optionsHtml(field, options, selected) {
  const isDynamic = Boolean(field.options && field.options.sql);
  const list = isDynamic
    ? (options[field.name] || [])
    : (field.options || []).filter((o) => Array.isArray(o));

  const rows = list.map(([value, label]) =>
    `<option value="${escapeHtml(value)}" ${valueOf(value) === valueOf(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`);

  if (!field.required && !list.some(([v]) => v === "")) {
    rows.unshift(`<option value="">— nenhum —</option>`);
  }
  return rows.join("");
}

export function renderField(field, values, { options = {}, errors = [] } = {}) {
  const value = values[field.name];
  const id = `f-${field.name}`;
  const help = field.help ? `<span class="field-help">${escapeHtml(field.help)}</span>` : "";
  const err = fieldError(errors, field.name);
  let control = "";

  switch (field.type) {
    case "textarea":
      control = `<textarea id="${id}" name="${field.name}" rows="3">${escapeHtml(valueOf(value))}</textarea>`;
      break;
    case "select":
      control = `<select id="${id}" name="${field.name}" ${field.required ? "required" : ""}>${optionsHtml(field, options, value)}</select>`;
      break;
    case "checkbox":
      control = `<span class="checkbox-wrap"><input type="checkbox" id="${id}" name="${field.name}" ${value ? "checked" : ""}></span>`;
      break;
    case "number":
      control = `<input type="number" id="${id}" name="${field.name}" step="${field.step || "any"}" ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""} value="${escapeHtml(valueOf(value))}">`;
      break;
    case "integer":
      control = `<input type="number" id="${id}" name="${field.name}" step="1" ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""} value="${escapeHtml(valueOf(value))}">`;
      break;
    case "datetime":
      control = `<input type="datetime-local" id="${id}" name="${field.name}" value="${escapeHtml(valueOf(value))}">`;
      break;
    case "date":
      control = `<input type="date" id="${id}" name="${field.name}" value="${escapeHtml(valueOf(value))}">`;
      break;
    default:
      control = `<input type="text" id="${id}" name="${field.name}" value="${escapeHtml(valueOf(value))}" ${field.required ? "required" : ""}>`;
  }

  return `<div class="${fieldClass(field, errors)}">
    <label for="${id}">${escapeHtml(field.label)}${field.required ? ' <abbr title="obrigatório">*</abbr>' : ""}</label>
    ${control}
    ${help}
    ${err}
  </div>`;
}

export function renderFormFields(entity, values, { options = {}, errors = [] } = {}) {
  return entity.fields
    .filter((f) => {
      if (!f.showIf) return true;
      try {
        return Boolean(f.showIf(values));
      } catch {
        return true;
      }
    })
    .map((f) => renderField(f, values, { options, errors }))
    .join("\n");
}

export function renderErrors(errors) {
  if (!errors || !errors.length) return "";
  return `<div class="form-errors" role="alert">
    <strong>Não foi possível gravar (${errors.length}):</strong>
    <ul>${errors.map((x) => `<li>${escapeHtml(x.message)}</li>`).join("")}</ul>
  </div>`;
}
