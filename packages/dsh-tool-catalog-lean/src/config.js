/**
 * Config surface for the preset author (#81 of spec #77): three knobs,
 * delivered through the plugin row's `config:` key.
 *
 * Verified convention (this cordis generation — cordis 4.0.1):
 *   - The loader unwraps the module namespace as the plugin object
 *     (`cordis-plugin-loader` `unwrapExports`) and starts it with
 *     `ctx.registry.plugin(plugin, entry.options.config)` — the row's
 *     `config:` value.
 *   - `ctx.plugin` validates config against the plugin's `Config` export
 *     when one exists; without a `Config` export the raw row config flows
 *     through unchanged (`resolveConfig`: "if (!runtime.Config) return
 *     config") and is handed to `apply(ctx, config)` as the second
 *     argument (`runtime.callback(this.ctx, this.config)`).
 *   - A user-layer patch row `- id: dsh-tool-catalog-lean` with a
 *     `config:` block sets that key on the bundle-inserted row
 *     (`applyEntryPatches` copies non-id patch keys onto the entry).
 *
 * This package declares NO `Config` schema on purpose: the only schema
 * library in the host is `@deepseek-ai/schemastery`, which is not a
 * declared dependency of this package (the profile installs it only as a
 * transitive host dependency, and a checkout install has no node_modules
 * to resolve it from). Instead `apply` accepts the raw row config and
 * resolves defaults here — the defensive shape the cordis loader fully
 * supports.
 *
 * Semantics (strict booleans — YAML gives real booleans):
 *   - `enabled`: default `true`; only an explicit boolean `false` disables
 *     the rewrite entirely (byte-identical stock catalog, for A/B checks).
 *   - `overrides`: plain object keyed by tool name; each value is a whole
 *     map entry (same shape as curated entries in ./map.js) that REPLACES
 *     the curated entry for that name — no per-property merging in v1.
 *     Entries for names the curated map lacks simply add new tools.
 *   - `diagnostics`: default `false`; only an explicit boolean `true`
 *     enables the one-per-assembly log line.
 */
import { isPlainObject } from "./util.js";

/**
 * Resolve the raw plugin-row config into normalized options. Pure: no
 * environment reads, no clocks. Anything unexpected degrades to the
 * documented default rather than throwing — a bad config must never break
 * the assembled catalog.
 */
export function resolveConfig(config) {
  const raw = isPlainObject(config) ? config : {};
  return {
    enabled: raw.enabled !== false,
    overrides: isPlainObject(raw.overrides) ? raw.overrides : {},
    diagnostics: raw.diagnostics === true,
  };
}

/**
 * Merge the override map over the curated map: whole-entry replacement
 * keyed by tool name (v1 semantics — an override entry stands on its own,
 * it is never per-property merged into the curated entry it shadows).
 * Pure and deterministic; called once per `apply` with the resolved
 * overrides, so the merged map is stable for the plugin's lifetime.
 * This function is the unit under test in `test/config.test.js`, which
 * pins that whole-entry-replacement override semantic (#81).
 */
export function mergeDescriptionMaps(curated, overrides) {
  return { ...curated, ...overrides };
}
