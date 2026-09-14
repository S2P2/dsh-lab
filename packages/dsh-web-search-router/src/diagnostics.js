/**
 * Bounded in-memory diagnostics (ticket #88): the 20 most recent search
 * executions globally, each carrying ordered backend attempt summaries with
 * ONLY permitted metadata — backend id, outcome/failure class, latency, retry
 * count, timestamp, cooldown-until. Never the query, result content, source
 * URLs, credentials, or raw provider response bodies. Nothing here persists
 * to disk and nothing ever writes session-event types — the session ledger's
 * vocabulary is a closed generated set and custom types poison session logs;
 * detailed trails go to the host logger only (see router.js safeLog).
 * @module
 */

/** Spec: retain the 20 most recent search executions globally. */
export const DIAGNOSTICS_RING_LIMIT = 20

/**
 * Project one finished execution into the ring's whitelist shape.
 * Drops `message` (upstream text) and anything not in the permitted set.
 * @param {{startedAt: number, outcome: 'served'|'exhausted'|'aborted', trail: object[]}} execution
 */
export function projectExecution({ startedAt, outcome, trail = [] }) {
  return {
    at: startedAt,
    outcome,
    backendAttempts: trail.map((entry) => {
      const projected = {
        backend: entry.backend,
        outcome: entry.outcome,
        latencyMs: entry.latencyMs ?? null,
        at: entry.at ?? null,
      }
      if (entry.failureClass !== undefined) projected.failureClass = entry.failureClass
      if (entry.retries !== undefined) projected.retries = entry.retries
      if (entry.reason !== undefined) projected.reason = entry.reason
      if (entry.cooldownUntil !== undefined) projected.cooldownUntil = entry.cooldownUntil
      return projected
    }),
  }
}

/**
 * @param {object} [options]
 * @param {number} [options.limit] ring size (default 20)
 */
export function createDiagnosticsRing(options = {}) {
  const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.floor(options.limit) : DIAGNOSTICS_RING_LIMIT
  /** @type {object[]} */
  const entries = []
  return {
    /** Record one finished execution; oldest entries fall off past the limit. */
    record(execution) {
      entries.push(execution)
      if (entries.length > limit) entries.splice(0, entries.length - limit)
    },
    /** Copy of the ring, oldest first. */
    snapshot() {
      return entries.map((entry) => structuredClone(entry))
    },
    /** Restart semantics: everything in memory goes away. */
    reset() {
      entries.length = 0
    },
  }
}
