/**
 * Pure parser: GLM Coding Plan quota-limit response JSON -> structured Reading.
 * Ported from pi-config's statusline-provider-quotas.ts (proven in production use).
 *
 * Windows are classified by response FIELDS, never by reset-time ordering:
 * a weekly window can legitimately reset before an open 5-hour window near the
 * end of a week, so ordering carries no signal (cc-switch issue #3036).
 *
 *   TOKENS_LIMIT unit 3 -> fiveHour   (rolling 5h window)
 *   TOKENS_LIMIT unit 6 -> weekly     (7d window from purchase)
 *   TIME_LIMIT   unit 5 -> tools      (MCP/tool spend lane, the pi "tools budget")
 *
 * Old plans (pre 2026-02-12) return a single TOKENS_LIMIT row; missing windows
 * stay null and the UI renders only what exists.
 */

/**
 * @param {any} json - parsed response body from /api/monitor/usage/quota/limit
 * @returns {null | {
 *   fiveHour: null | {pct: number|null, resetAt: number|null},
 *   weekly:   null | {pct: number|null, resetAt: number|null},
 *   tools:    null | {pct: number|null, resetAt: number|null},
 *   plan:     null | string,
 * }} structured reading, or null when nothing usable is present
 */
export function parseGlmQuota(json) {
  const limits = json?.data?.limits;
  if (!Array.isArray(limits) || limits.length === 0) return null;

  const find = (type, unit) => {
    const entry = limits.find(
      (l) => l && typeof l === "object" && l.type === type && l.unit === unit
    );
    if (!entry) return null;
    const pct =
      typeof entry.percentage === "number" && Number.isFinite(entry.percentage)
        ? Math.floor(entry.percentage)
        : null;
    const resetAt =
      typeof entry.nextResetTime === "number" && Number.isFinite(entry.nextResetTime)
        ? entry.nextResetTime
        : null;
    if (pct === null && resetAt === null) return null;
    return { pct, resetAt };
  };

  const reading = {
    fiveHour: find("TOKENS_LIMIT", 3),
    weekly: find("TOKENS_LIMIT", 6),
    tools: find("TIME_LIMIT", 5),
    plan: typeof json?.data?.level === "string" ? json.data.level : null,
  };

  if (!reading.fiveHour && !reading.weekly && !reading.tools) return null;
  return reading;
}
