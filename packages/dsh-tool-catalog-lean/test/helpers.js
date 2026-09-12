/**
 * Shared test helpers. Plain `node:test` + `node:assert` only — the
 * package adds no dependencies.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The captured 23-tool stock catalog from the exported `standard-lean`
 * session log, committed as test data. Compact serialization is 21,062
 * chars — tests assert that provenance guard.
 */
export function loadStockTools() {
  const raw = readFileSync(path.join(here, "fixtures", "stock-tools.json"), "utf8");
  return JSON.parse(raw);
}

/**
 * Recursively strip every string-valued `description` key from a catalog
 * (tool-level and anywhere inside parameters/output_schema). Property
 * *names* like `properties.description` are objects, not strings, so they
 * survive — only description strings are removed.
 */
export function stripDescriptions(value) {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "description" && typeof child === "string") continue;
      out[key] = stripDescriptions(child);
    }
    return out;
  }
  return value;
}

/** Total characters across every description string in one tool schema. */
export function countDescriptionChars(value, total = 0) {
  if (Array.isArray(value)) {
    return value.reduce((acc, child) => acc + countDescriptionChars(child), total);
  }
  if (value !== null && typeof value === "object") {
    let sum = total;
    for (const [key, child] of Object.entries(value)) {
      if (key === "description" && typeof child === "string") sum += child.length;
      else sum += countDescriptionChars(child);
    }
    return sum;
  }
  return total;
}

/**
 * Faithful replica of cordis `Context.waterfall` composition semantics
 * (listeners run outermost-first in registration order; the last payload
 * argument is the innermost `next`; the outermost listener's return value
 * is the waterfall's result). Used when a real `@deepseek-ai/cordis` is
 * not importable — the integration test then still exercises the exact
 * listener contract the host waterfall implements.
 */
export function composeWaterfall(listeners, payload, innermost) {
  const queue = [...listeners];
  const args = [...payload];
  const next = () => (queue.shift() ?? innermost)(...args);
  args.push(next);
  return next();
}

/**
 * Try to load a real `@deepseek-ai/cordis` module for the integration
 * test. Lookup order: the `DSH_TEST_CORDIS_ENTRY` override, then known
 * npx-cache install locations. Returns `{ Context }` or null.
 */
export async function loadRealCordis() {
  const candidates = [
    process.env.DSH_TEST_CORDIS_ENTRY,
    "/home/jo/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/cordis/lib/index.js",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const mod = await import(new URL(`file://${candidate}`).href);
      if (mod.Context) return mod;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}
