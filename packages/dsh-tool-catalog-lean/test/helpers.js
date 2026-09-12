/**
 * Shared test helpers. Plain `node:test` + `node:assert` only — the
 * package adds no dependencies.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
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
 * Resolve the entry file of an installed `@deepseek-ai/<pkgName>`
 * package, portably. Lookup order:
 *   1. the `<envVar>` path override (highest priority, always wins);
 *   2. normal module resolution from this test context
 *      (`import.meta.resolve`) — present when the checkout install
 *      provides the package;
 *   3. the npx cache glob `~/.npm/_npx/<hash>/node_modules/@deepseek-ai/<pkg>`
 *      (first candidate whose package.json parses and whose entry file
 *      exists wins); `preferredNpxDir`, when given, is searched first so
 *      two packages that must match versions can be paired to one
 *      install.
 *
 * Returns `{ entry, source, npxDir }` (npxDir null unless found in the
 * cache) or null when nothing resolves.
 */
async function resolveDeepseekEntry(pkgName, envVar, preferredNpxDir = null) {
  const override = process.env[envVar];
  if (override) return { entry: override, source: `env ${envVar}`, npxDir: null };

  try {
    const entry = fileURLToPath(import.meta.resolve(pkgName));
    return { entry, source: "import.meta.resolve", npxDir: null };
  } catch {
    /* not resolvable from this checkout — fall through to the npx cache */
  }

  const cacheRoot = path.join(homedir(), ".npm", "_npx");
  let hashDirs = [];
  try {
    hashDirs = readdirSync(cacheRoot).sort();
  } catch {
    return null; // no npx cache at all
  }
  const bases = [];
  if (preferredNpxDir) bases.push(preferredNpxDir);
  for (const dir of hashDirs) bases.push(path.join(cacheRoot, dir));
  for (const base of bases) {
    const pkgDir = path.join(base, "node_modules", "@deepseek-ai", pkgName);
    try {
      const meta = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
      const entry = path.join(pkgDir, meta.main ?? "lib/index.js");
      if (existsSync(entry)) {
        return { entry, source: `npx cache ${base}`, npxDir: base };
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/** Dynamic-import a resolved entry; null when it fails to load. */
async function importOrNull(entry) {
  try {
    return await import(pathToFileURL(entry).href);
  } catch {
    return null;
  }
}

let cordisPromise;

/**
 * Try to load a real `@deepseek-ai/cordis` for the integration tests
 * (memoized — every caller observes the same resolution). Returns
 * `{ Context, source }` or null; `source` says how it was found, so a
 * replica-only run can report the degradation instead of passing
 * silently.
 */
export function loadRealCordis() {
  cordisPromise ??= (async () => {
    const resolved = await resolveDeepseekEntry("cordis", "DSH_TEST_CORDIS_ENTRY");
    if (!resolved) return null;
    const mod = await importOrNull(resolved.entry);
    if (!mod?.Context) return null;
    return { Context: mod.Context, source: resolved.source, npxDir: resolved.npxDir };
  })();
  return cordisPromise;
}

let systemPromptPromise;

/**
 * Try to load a real `@deepseek-ai/dsh-system-prompt` (memoized). The
 * npx-cache lookup prefers the install the cordis resolution landed on,
 * so the composed test runs one coherent host generation. Returns
 * `{ SystemPrompt, source }` or null.
 */
export function loadRealSystemPrompt() {
  systemPromptPromise ??= (async () => {
    const cordis = await loadRealCordis();
    const resolved = await resolveDeepseekEntry(
      "dsh-system-prompt",
      "DSH_TEST_SYSTEM_PROMPT_ENTRY",
      cordis?.npxDir ?? null,
    );
    if (!resolved) return null;
    const mod = await importOrNull(resolved.entry);
    if (!mod?.SystemPrompt) return null;
    return { SystemPrompt: mod.SystemPrompt, source: resolved.source };
  })();
  return systemPromptPromise;
}
