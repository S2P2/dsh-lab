/**
 * dsh-tool-catalog-lean host entry.
 *
 * Registers one `system-prompt/assemble` waterfall listener that projects
 * `assembly.tools` through the curated description map: the model sees the
 * same tools with shorter, semantically faithful descriptions. The
 * waterfall's return value is authoritative (dsh-system-prompt uses it as
 * the assembled prompt source), and schemas are cloned before the
 * waterfall reaches listeners, so replacing `assembly.tools` in place and
 * returning `next()` is the established pattern.
 *
 * Config (see ./config.js for the verified row-config convention): the
 * plugin row's `config:` key reaches `apply` as its second argument.
 * `enabled: false` registers nothing at all — the assembled catalog stays
 * byte-identical to stock, so a session can A/B the compression.
 * `overrides` merge over the curated map (whole-entry replacement per
 * tool name) once, here, at apply time. `diagnostics: true` emits one log
 * line per assembly with tool count and before/after compact-JSON sizes.
 *
 * Deliberately NOT done here: registering tools, restricting visibility
 * (`ctx.tools.restrict()`), adding prompt sections, or touching runtime
 * validation/sandboxing/approvals/execution in any way.
 */
import { descriptionMap } from "./map.js";
import { projectTools } from "./transform.js";
import { mergeDescriptionMaps, resolveConfig } from "./config.js";

export const name = "dsh-tool-catalog-lean";

/**
 * Emit the diagnostics line: tool count and the compact-JSON serialized
 * sizes of `assembly.tools` before and after the projection — the same
 * `JSON.stringify` measurement the tests apply. Diagnostics must never
 * alter the delivered assembly, so a missing or throwing logger is
 * swallowed: the line is a host-side side channel, not a product path.
 */
function emitDiagnostics(ctx, toolCount, beforeChars, afterChars) {
  try {
    ctx?.logger?.info?.(
      `tool-catalog-lean: ${toolCount} tools, ${beforeChars} -> ${afterChars} chars`,
    );
  } catch {
    /* a broken logger must not break the assembly */
  }
}

export function apply(ctx, config) {
  const options = resolveConfig(config);
  // Explicit off switch: no listener, no mutation — stock catalog as-is.
  if (!options.enabled) return;

  // Merged once, deterministically, at apply time (rebuilt on config
  // hot-reload, when the loader restarts the plugin with fresh config).
  const map = mergeDescriptionMaps(descriptionMap, options.overrides);

  ctx.on("system-prompt/assemble", (assembly, _context, next) => {
    if (assembly !== null && typeof assembly === "object" && Array.isArray(assembly.tools)) {
      const beforeChars = options.diagnostics ? JSON.stringify(assembly.tools).length : 0;
      const tools = projectTools(assembly.tools, map);
      if (options.diagnostics) {
        emitDiagnostics(ctx, assembly.tools.length, beforeChars, JSON.stringify(tools).length);
      }
      assembly.tools = tools;
    }
    return next();
  });
}
