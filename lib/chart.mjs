const WIDTH = 760;
const HEIGHT = 300;
const PAD = { top: 18, right: 20, bottom: 42, left: 72 };

function niceStep(raw) {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const frac = raw / base;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * base;
}

function tickValues(min, max, count) {
  if (min === max) return [min];
  const step = niceStep((max - min) / Math.max(1, count - 1));
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step * 1e-6 && out.length < 12; v += step) {
    out.push(Number(v.toFixed(10)));
  }
  if (!out.length) out.push(min, max);
  return out;
}

function fmtAxis(v) {
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 0.01 || abs >= 10000)) {
    return v.toExponential(1);
  }
  return Number(v.toFixed(3)).toLocaleString("pt-BR", {
    maximumFractionDigits: 3,
  });
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Server-rendered SVG time series: measured values over time with the
 * legislation limits drawn as reference lines. No JS, no dependencies.
 *
 * points:     [{ t: ISO|Date|ms, y: number, label: string }]
 * thresholds: [{ y: number, label: string, kind: "max"|"min"|"range" }]
 */
export function timeChart({ points, thresholds = [], yUnit = "" }) {
  if (!points || !points.length) return "";

  const data = points
    .map((p) => ({
      t: p.t instanceof Date ? p.t.getTime() : new Date(p.t).getTime(),
      y: Number(p.y),
      label: p.label || "",
    }))
    .filter((p) => !Number.isNaN(p.t) && !Number.isNaN(p.y))
    .sort((a, b) => a.t - b.t);

  if (!data.length) return "";

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  let tMin = Math.min(...data.map((d) => d.t));
  let tMax = Math.max(...data.map((d) => d.t));
  if (tMin === tMax) {
    tMin -= 12 * 3600 * 1000;
    tMax += 12 * 3600 * 1000;
  }

  const visibleThresholds = thresholds.filter(
    (th) => th && th.y !== null && th.y !== undefined && !Number.isNaN(Number(th.y)),
  );
  const yValues = [...data.map((d) => d.y), ...visibleThresholds.map((th) => Number(th.y))];
  let yMin = Math.min(...yValues);
  let yMax = Math.max(...yValues);
  if (yMin === yMax) {
    yMin -= Math.abs(yMin) * 0.1 + 1;
    yMax += Math.abs(yMax) * 0.1 + 1;
  }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;
  if (yMin > 0 && yMin - yPad < 0 && yMin / (yMax - yMin) < 0.25) yMin = 0;

  const x = (t) => PAD.left + ((t - tMin) / (tMax - tMin)) * innerW;
  const y = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const yTicks = tickValues(yMin, yMax, 5);
  const xTicks = Array.from({ length: 5 }, (_, i) => tMin + ((tMax - tMin) * i) / 4);

  const grid = yTicks
    .map(
      (v) =>
        `<line class="chart-grid" x1="${PAD.left}" y1="${y(v).toFixed(1)}" x2="${WIDTH - PAD.right}" y2="${y(v).toFixed(1)}"/>` +
        `<text class="chart-tick" x="${PAD.left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(fmtAxis(v))}</text>`,
    )
    .join("");

  const xAxis = xTicks
    .map((t) => {
      const d = new Date(t);
      const label = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      return `<text class="chart-tick" x="${x(t).toFixed(1)}" y="${HEIGHT - PAD.bottom + 20}" text-anchor="middle">${label}</text>`;
    })
    .join("");

  const thresholdSvg = visibleThresholds
    .map((th, i) => {
      const yy = y(Number(th.y));
      const color = th.kind === "min" ? "#2f6fb0" : "#c0392b";
      const labelY = yy - 6 - (i % 2) * 13;
      return (
        `<line class="chart-limit" x1="${PAD.left}" y1="${yy.toFixed(1)}" x2="${WIDTH - PAD.right}" y2="${yy.toFixed(1)}" stroke="${color}"/>` +
        `<text class="chart-limit-label" x="${WIDTH - PAD.right}" y="${Math.max(PAD.top + 10, labelY).toFixed(1)}" text-anchor="end" fill="${color}">${esc(th.label)}</text>`
      );
    })
    .join("");

  const linePoints = data.map((d) => `${x(d.t).toFixed(1)},${y(d.y).toFixed(1)}`).join(" ");
  const dots = data
    .map(
      (d) =>
        `<circle class="chart-dot" cx="${x(d.t).toFixed(1)}" cy="${y(d.y).toFixed(1)}" r="4"><title>${esc(d.label)}</title></circle>`,
    )
    .join("");

  const unitLabel = yUnit
    ? `<text class="chart-axis-title" transform="rotate(-90 16 ${PAD.top + innerH / 2})" x="16" y="${PAD.top + innerH / 2}" text-anchor="middle">${esc(yUnit)}</text>`
    : "";

  return `<svg class="chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Série temporal de resultados">
  ${grid}${xAxis}${unitLabel}
  ${thresholdSvg}
  <polyline class="chart-line" points="${linePoints}"/>
  ${dots}
</svg>`;
}
