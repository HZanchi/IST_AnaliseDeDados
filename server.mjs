import { createServer } from "node:http";
import { matchRoute, notFound, internalError } from "./routes.mjs";
import { closePool, describeConnection } from "./lib/db.mjs";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

const MAX_BODY_BYTES = 300 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("corpo da requisição maior que 300 KB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseBody(req) {
  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") return {};
  const raw = await readBody(req);
  if (!raw) return {};
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [key, value] of params) {
    if (key in out) {
      out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const matched = matchRoute(req.method, url.pathname);

  let result;
  if (!matched) {
    result = notFound(req.method, url.pathname);
  } else {
    try {
      const body = await parseBody(req);
      result = await matched.route.handler({
        req,
        res,
        params: matched.params,
        query: url.searchParams,
        body,
      });
    } catch (err) {
      console.error(`[web] ${req.method} ${url.pathname} failed:`, err);
      result = internalError(err);
    }
  }

  res.writeHead(result.status, {
    ...result.headers,
    "cache-control": "no-store",
  });
  res.end(result.body);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("[web] unhandled request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("internal error");
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[web] port ${PORT} is already in use — another instance is running, or set PORT=<other>`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  let target = "(DATABASE_URL not set yet)";
  try {
    const c = describeConnection();
    target = `${c.host}:${c.port}/${c.database}`;
  } catch (err) {
    target = `unavailable — ${err.message}`;
  }
  console.log(`[web] waterquality dashboard on http://${HOST}:${PORT}`);
  console.log(`[web] database: ${target}`);
  console.log(`[web] health check: http://${HOST}:${PORT}/health`);
});

async function shutdown(signal) {
  console.log(`[web] ${signal} received, shutting down`);
  server.close();
  try {
    await closePool();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
