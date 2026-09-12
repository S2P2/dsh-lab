/**
 * Pure, deterministic description-only projection of a tool catalog.
 *
 * `projectTools(tools, map)` takes a `ToolSchema[]` (entries like
 * `{ name, description, parameters }`) and a description map keyed by
 * tool name (see ./map.js for the entry shape) and returns a new array
 * where curated tools carry replacement description strings — the
 * tool-level `description` plus every `description` string found
 * recursively inside `parameters`.
 *
 * Guarantees, by construction:
 *   - descriptions-only: no other key is read-for-write; names, types,
 *     `required`, enums, `additionalProperties`, and all structure pass
 *     through untouched (tests strip every description and deep-compare);
 *   - byte-identical pass-through: tools absent from the map are returned
 *     as the same object reference; curated tools keep their original
 *     reference for any subtree without a replacement — the walker only
 *     follows shapes it curates, so unknown nodes pass through untouched;
 *   - pure: inputs are never mutated, no environment reads, no clocks,
 *     no randomness — same input, identical output.
 */
import { cowClone, isPlainObject } from "./util.js";

/**
 * Rewrite description strings inside one schema node, guided by a
 * replacement tree shaped like the schema (`description`, `properties`,
 * object-form `items`). In `properties`, a string value is shorthand for
 * "replace that property node's description"; a plain object is a nested
 * replacement node (for properties that are themselves schemas).
 * Copy-on-write: returns the original node reference when nothing below
 * it changes.
 */
function rewriteSchemaNode(node, replacement) {
  if (!isPlainObject(node) || !isPlainObject(replacement)) return node;

  let out = node;

  if (
    typeof replacement.description === "string" &&
    typeof node.description === "string" &&
    node.description !== replacement.description
  ) {
    out = cowClone(out, node);
    out.description = replacement.description;
  }

  if (isPlainObject(replacement.properties) && isPlainObject(node.properties)) {
    let changed = false;
    const next = {};
    for (const [key, child] of Object.entries(node.properties)) {
      const curated = replacement.properties[key];
      let projected = child;
      if (typeof curated === "string") {
        // Shorthand: curated string is this property node's new description.
        if (
          isPlainObject(child) &&
          typeof child.description === "string" &&
          child.description !== curated
        ) {
          projected = { ...child, description: curated };
        }
      } else if (isPlainObject(curated)) {
        projected = rewriteSchemaNode(child, curated);
      }
      next[key] = projected;
      if (projected !== child) changed = true;
    }
    if (changed) {
      out = cowClone(out, node);
      out.properties = next;
    }
  }

  if (isPlainObject(replacement.items) && isPlainObject(node.items)) {
    const projected = rewriteSchemaNode(node.items, replacement.items);
    if (projected !== node.items) {
      out = cowClone(out, node);
      out.items = projected;
    }
  }

  return out;
}

function projectTool(tool, entry) {
  if (!isPlainObject(entry)) return tool;

  let out = tool;

  if (
    typeof entry.description === "string" &&
    typeof tool.description === "string" &&
    tool.description !== entry.description
  ) {
    out = cowClone(out, tool);
    out.description = entry.description;
  }

  if (isPlainObject(entry.parameters) && isPlainObject(tool.parameters)) {
    const projected = rewriteSchemaNode(tool.parameters, entry.parameters);
    if (projected !== tool.parameters) {
      out = cowClone(out, tool);
      out.parameters = projected;
    }
  }

  return out;
}

/**
 * Project a tool-schema array through a description map. Returns a new
 * array; tools without a curated entry are the identical references.
 */
export function projectTools(tools, map) {
  if (!Array.isArray(tools)) return tools;
  const curated = isPlainObject(map) ? map : {};
  return tools.map((tool) => {
    if (!isPlainObject(tool)) return tool;
    const entry =
      typeof tool.name === "string" && Object.prototype.hasOwnProperty.call(curated, tool.name)
        ? curated[tool.name]
        : undefined;
    return projectTool(tool, entry);
  });
}
