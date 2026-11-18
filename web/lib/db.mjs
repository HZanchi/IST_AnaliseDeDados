import pg from "pg";
import { databaseUrl } from "./config.mjs";

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl(), max: 5 });
    pool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function ping() {
  const started = process.hrtime.bigint();
  await query("SELECT 1");
  return Number(process.hrtime.bigint() - started) / 1e6;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function describeConnection() {
  const url = new URL(databaseUrl());
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, ""),
    user: url.username || "(default)",
  };
}
