import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getOverview,
  listSamples,
  getSampleDetail,
  getParameterCatalog,
  getParameterByCode,
  getTimeline,
  getComparative,
  getLegislations,
  getLimits,
  getDashboardKpis,
  hasDemoData,
} from "./lib/data.mjs";
import { renderOverview } from "./pages/overview.mjs";
import { renderSamples } from "./pages/samples.mjs";
import { renderSampleDetail } from "./pages/sample_detail.mjs";
import { renderTimeline } from "./pages/timeline.mjs";
import { renderComparative } from "./pages/comparative.mjs";
import { renderLimits } from "./pages/limits.mjs";
import { renderReport } from "./pages/report.mjs";
import { buildSampleReport, ReportError, NO_TARGET_TOKENS } from "./lib/report.mjs";
import { errorPage, notFoundPage } from "./lib/html.mjs";
import { adminRoutes } from "./routes/admin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(join(here, "public", "styles.css"), "utf8");

const HTML = { "content-type": "text/html; charset=utf-8" };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function html(body, status = 200) {
  return { status, headers: HTML, body };
}

function pickParameter(catalog, requested) {
  if (requested) {
    const hit = catalog.find(
      (p) => p.code.toLowerCase() === requested.toLowerCase(),
    );
    if (hit) return hit;
  }
  const score = (p) =>
    (p.result_count > 0 ? 4 : 0) +
    (p.limit_count > 0 ? 2 : 0) +
    Math.min(Number(p.result_count) || 0, 3) / 10;
  return [...catalog].sort((a, b) => score(b) - score(a))[0] || null;
}

export const routes = [
  {
    method: "GET",
    path: "/",
    handler: async () => {
      const [overview, kpis, samples, demo] = await Promise.all([
        getOverview(),
        getDashboardKpis(),
        listSamples({ limit: 500 }),
        hasDemoData(),
      ]);
      return html(renderOverview({ overview, kpis, samples, demo }));
    },
  },
  {
    method: "GET",
    path: "/health",
    handler: async () => {
      const data = await getOverview();
      const payload = {
        ok: data.ok,
        checkedAt: new Date().toISOString(),
        latencyMs: data.latencyMs,
        connection: data.connection,
        serverVersion: data.serverVersion,
        counts: data.counts,
        countsSource: data.countsSource,
        migrations: data.migrations.map((m) => m.name),
        views: data.views,
        hasSamples: data.hasSamples,
        error: data.error,
      };
      return {
        status: data.ok ? 200 : 503,
        headers: JSON_HEADERS,
        body: JSON.stringify(payload, null, 2),
      };
    },
  },
  {
    method: "GET",
    path: "/styles.css",
    handler: () => ({
      status: 200,
      headers: { "content-type": "text/css; charset=utf-8" },
      body: stylesCss,
    }),
  },
  {
    method: "GET",
    path: "/amostras",
    handler: async ({ query }) => {
      const samples = await listSamples({ limit: 500 });
      const filters = {
        state: query.get("estado") || "",
        matrix: query.get("matriz") || "",
      };
      return html(renderSamples({ samples, filters }));
    },
  },
  {
    method: "GET",
    path: "/amostras/:code",
    handler: async ({ params }) => {
      const detail = await getSampleDetail(params.code);
      if (!detail) {
        return html(
          errorPage(
            "Amostra não encontrada",
            `Nenhuma amostra com o código "${params.code}" existe no banco.`,
          ),
          404,
        );
      }
      const demo = Boolean(detail.sample.metadata?.demo);
      return html(renderSampleDetail(detail, { demo }));
    },
  },
  {
    // PRO-19 / PRO-5 §3 — relatório por amostra. A lei vinculante é parâmetro
    // de renderização (`?lei=<codigo>`), nunca uma coluna do esquema (§5.2).
    method: "GET",
    path: "/amostras/:code/relatorio",
    handler: async ({ params, query }) => {
      const raw = query.get("lei");
      const target =
        raw === null
          ? undefined
          : NO_TARGET_TOKENS.has(raw.trim().toLowerCase())
            ? null
            : raw;
      let report;
      try {
        report = await buildSampleReport(params.code, { target });
      } catch (err) {
        if (err instanceof ReportError) {
          return html(errorPage("Relatório não emitido", err.message), err.status);
        }
        throw err;
      }
      if (!report) {
        return html(
          errorPage(
            "Amostra não encontrada",
            `Nenhuma amostra com o código "${params.code}" existe no banco.`,
          ),
          404,
        );
      }
      return html(renderReport(report));
    },
  },
  {
    method: "GET",
    path: "/resultados",
    handler: async ({ query }) => {
      const catalog = (await getParameterCatalog()).filter(
        (p) => p.result_count > 0 || p.limit_count > 0,
      );
      const requested = query.get("param");
      const picked = requested
        ? catalog.find((p) => p.code.toLowerCase() === requested.toLowerCase()) ||
          (await getParameterByCode(requested))
        : pickParameter(catalog, null);
      if (!picked) {
        if (requested) {
          return html(
            errorPage(
              "Parâmetro não encontrado",
              `Nenhum parâmetro com o código "${requested}" no catálogo.`,
            ),
            404,
          );
        }
      }
      if (!picked) {
        return html(
          errorPage(
            "Sem parâmetros",
            "Nenhum parâmetro com resultados ou limites foi encontrado. Carregue dados para explorar o dashboard.",
          ),
          404,
        );
      }
      const timeline = await getTimeline(picked.code);
      if (!timeline) {
        return html(
          errorPage("Parâmetro não encontrado", `Nenhum parâmetro com o código "${picked.code}".`),
          404,
        );
      }
      return html(renderTimeline({ timeline, catalog, selectedCode: picked.code }));
    },
  },
  {
    method: "GET",
    path: "/comparativo",
    handler: async ({ query }) => {
      const all = await getParameterCatalog();
      const catalog = all.filter((p) => p.limit_count > 0 || p.result_count > 0);
      const requested = query.get("param");
      let picked = requested
        ? catalog.find((p) => p.code.toLowerCase() === requested.toLowerCase()) ||
          (await getParameterByCode(requested))
        : pickParameter(catalog, null);
      if (!picked) {
        return html(
          errorPage(
            "Sem parâmetros",
            "Nenhum parâmetro com limites ou resultados foi encontrado no catálogo.",
          ),
          404,
        );
      }
      const comparative = await getComparative(picked.code);
      if (!comparative) {
        return html(
          errorPage("Parâmetro não encontrado", `Nenhum parâmetro com o código "${picked.code}".`),
          404,
        );
      }
      return html(
        renderComparative({ comparative, catalog, selectedCode: picked.code }),
      );
    },
  },
  {
    method: "GET",
    path: "/limites",
    handler: async ({ query }) => {
      const [laws, catalog] = await Promise.all([
        getLegislations(),
        getParameterCatalog({ onlyWithLimits: true }),
      ]);
      const selectedLaw = query.get("lei") || null;
      const selectedParam = query.get("param") || null;
      const { rows, statsByLaw } = await getLimits({
        lawCode: selectedLaw,
        parameterCode: selectedParam,
      });
      return html(
        renderLimits({
          rows,
          statsByLaw,
          laws,
          selectedLaw,
          selectedParam,
        }),
      );
    },
  },
  ...adminRoutes,
];

export function matchRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

function matchPath(pattern, pathname) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const p = patternParts[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (p !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function notFound(method, pathname) {
  return html(notFoundPage(method, pathname), 404);
}

export function internalError(err) {
  console.error("[web] handler error:", err);
  return html(
    errorPage("Erro no servidor", err.message || "falha interna"),
    500,
  );
}
