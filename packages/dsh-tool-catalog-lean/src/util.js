/**
 * Tiny shared helpers for the description projection. No dependencies.
 */

/**
 * True for plain objects (not null, not an array) — the only node shape
 * the projection walker reads for rewriting.
 */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copy-on-write step of the shared clone-then-assign shape: return a
 * shallow clone of `original` while `out` is still the untouched
 * original, and `out` itself afterwards — first write clones, later
 * writes reuse the clone.
 */
export function cowClone(out, original) {
  return out === original ? { ...original } : out;
}
