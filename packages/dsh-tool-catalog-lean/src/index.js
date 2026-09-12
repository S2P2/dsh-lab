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
 * Deliberately NOT done here: registering tools, restricting visibility
 * (`ctx.tools.restrict()`), adding prompt sections, or touching runtime
 * validation/sandboxing/approvals/execution in any way.
 */
import { descriptionMap } from "./map.js";
import { projectTools } from "./transform.js";

export const name = "dsh-tool-catalog-lean";

export function apply(ctx) {
  ctx.on("system-prompt/assemble", (assembly, _context, next) => {
    if (assembly !== null && typeof assembly === "object" && Array.isArray(assembly.tools)) {
      assembly.tools = projectTools(assembly.tools, descriptionMap);
    }
    return next();
  });
}
