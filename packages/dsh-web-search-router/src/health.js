/**
 * Passive, process-local health + cooldown store (ticket #88).
 *
 * Store shape follows A3Boy/dsh-web-tools' provider-health (MIT prior art):
 * one Map keyed by stable backend id, lazy expiry on read (no timer
 * bookkeeping), `snapshot()` for the Settings UI, in-memory only — a process
 * restart clears everything by construction (nothing is persisted).
 *
 * Policy (spec #8): provider-supplied `Retry-After` is honored; quota and
 * rate-limit failures default to an approximately 15-minute cooldown; network
 * and upstream failures take short exponential cooldowns starting around
 * 30 s and capped around 5 minutes; auth/config failures keep the backend
 * unavailable until relevant credential/settings state changes (cleared via
 * `clear`/`clearAll` — never by time). Abort, timeout, malformed, and empty
 * failures never write cooldown state. Cooldowns only degrade availability —
 * they never change chain order.
 * @module
 */

/** Default quota/rate-limit cooldown when no structured reset signal exists. */
export const DEFAULT_QUOTA_COOLDOWN_MS = 15 * 60_000

/** First transient (network/upstream) cooldown; doubles per consecutive strike. */
export const TRANSIENT_COOLDOWN_BASE_MS = 30_000

/** Exponential growth cap for transient cooldowns. */
export const TRANSIENT_COOLDOWN_CAP_MS = 5 * 60_000

/** Failure classes that cool the backend down when recorded. */
const COOLED_CLASSES = new Set(['quota', 'rate_limit', 'network', 'upstream', 'auth', 'config'])

/** Fixed credential reference → backend id (spec story 29 mapping). */
export const CREDENTIAL_REF_BACKENDS = new Map([
  ['EXA_API_KEY', 'exa'],
  ['TAVILY_API_KEY', 'tavily'],
  ['ZAI_API_KEY', 'zai'],
])

/**
 * @param {object} [options]
 * @param {() => number} [options.now] injectable clock
 */
export function createHealthStore(options = {}) {
  const { now = () => Date.now() } = options
  /** @type {Map<string, {cooldownUntil: number, lastFailureClass: string, strikes: number}>} */
  const state = new Map()

  const entryFor = (id) => {
    let entry = state.get(id)
    if (entry === undefined) {
      entry = { cooldownUntil: 0, lastFailureClass: '', strikes: 0 }
      state.set(id, entry)
    }
    return entry
  }

  return {
    /** True while the backend is cooling down (lazy expiry; state-change blocks never expire). */
    isCooling(id) {
      const entry = state.get(id)
      if (entry === undefined) return false
      if (entry.cooldownUntil === Number.POSITIVE_INFINITY) return true
      if (entry.cooldownUntil <= now()) {
        state.delete(id)
        return false
      }
      return true
    },

    /**
     * Record one classified failure. Only cooled classes write cooldown
     * state; a provider-supplied `retryAfterMs` overrides the default
     * duration for quota/rate-limit failures. Transient classes grow
     * exponentially per CONSECUTIVE transient strike — any non-transient
     * outcome (timeout/malformed/empty) or success resets the streak by
     * dropping state.
     * @param {string} id @param {{failureClass: string, retryAfterMs?: number}} error
     */
    recordFailure(id, error) {
      const failureClass = error?.failureClass
      if (typeof failureClass !== 'string' || !COOLED_CLASSES.has(failureClass)) {
        // Non-cooled classes (timeout/malformed/empty) still interrupt a
        // transient streak: the next network/upstream failure starts at the
        // base cooldown again. Caller aborts never reach this method.
        state.delete(id)
        return
      }
      const previous = state.get(id)
      const at = now()
      if (failureClass === 'quota' || failureClass === 'rate_limit') {
        const duration = typeof error.retryAfterMs === 'number' && error.retryAfterMs > 0
          ? error.retryAfterMs
          : DEFAULT_QUOTA_COOLDOWN_MS
        state.set(id, { cooldownUntil: at + duration, lastFailureClass: failureClass, strikes: 0 })
        return
      }
      if (failureClass === 'network' || failureClass === 'upstream') {
        const strikes = (previous?.lastFailureClass === 'network' || previous?.lastFailureClass === 'upstream'
          ? previous.strikes
          : 0) + 1
        const duration = Math.min(TRANSIENT_COOLDOWN_CAP_MS, TRANSIENT_COOLDOWN_BASE_MS * 2 ** (strikes - 1))
        state.set(id, { cooldownUntil: at + duration, lastFailureClass: failureClass, strikes })
        return
      }
      // auth / config: unavailable until the relevant credential/settings state changes.
      state.set(id, { cooldownUntil: Number.POSITIVE_INFINITY, lastFailureClass: failureClass, strikes: 0 })
    },

    /** Success clears transient state for the serving backend. */
    clear(id) {
      state.delete(id)
    },

    /** Settings changes clear every backend's health (conservative, next-search effect). */
    clearAll() {
      state.clear()
    },

    /** UI-facing projection (#92): never exposes secrets, only class + cooldown facts. */
    snapshot() {
      const at = now()
      const result = []
      for (const [id, entry] of state) {
        if (entry.cooldownUntil === Number.POSITIVE_INFINITY) {
          result.push({ id, state: 'unavailable-until-state-change', lastFailureClass: entry.lastFailureClass })
        } else if (entry.cooldownUntil > at) {
          result.push({ id, state: 'cooling', cooldownUntil: entry.cooldownUntil, lastFailureClass: entry.lastFailureClass })
        }
      }
      return result
    },
  }
}
