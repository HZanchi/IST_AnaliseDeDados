import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const appRoot = join(here, "..");

function loadEnv() {
  const envPath = join(appRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

/**
 * Modo somente leitura do editor (/admin). Ligado com READ_ONLY=1|true|yes.
 * Interruptor de segurança previsto em PRO-9: a escrita é recusada (403) e os
 * formulários ficam desativados enquanto estiver ligado.
 */
export function isReadOnly() {
  const v = (process.env.READ_ONLY || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não definido. Copie .env.example para .env e configure a conexão.",
    );
  }
  return url;
}
