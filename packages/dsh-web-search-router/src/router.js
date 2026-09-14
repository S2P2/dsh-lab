/**
 * The routing WebSearchProvider core: walks internal adapters sequentially,
 * stops at the first structurally valid result, treats caller abort as
 * terminal cancellation that never records a backend failure, and surfaces
 * chain exhaustion as one sanitized model-facing error with the detailed
 * ordered trail going to the host logger only (spec #8).
 *
 * Failure policy (ticket #87): one retry per backend for clearly transient
 * failures only (adapter-marked retryable — transport failures and
 * 502/503/504 equivalents — outside the never-retry set); a 15 s overall
 * budget covers attempts, retries, and retry delays; each attempt is capped
 * (5 s default) and clamped to the remaining budget; no new attempt or retry
 * starts after the budget is exhausted; a provider-supplied `Retry-After` is
 * honored as the retry delay but never allowed to exceed the deadline.
 * Bounded adapter-internal protocol repair (e.g. a stale-session re-init
 * inside one adapter.search call) is invisible here — it is one attempt.
 *
 * The walk owns deadlines via the injectable `schedule`/`now` seams; no DSH
 * imports — this module is the hermetic test seam.
 * @module
 */
import { AdapterError, SearchAbortedError, ChainExhaustedError } from './errors.js'
import { isAbortLike } from './http.js'
import {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_OVERALL_TIMEOUT_MS,
  MAX_RETRIES_PER_BACKEND,
  isRetryable,
  retryDelayMs,
  clampAttemptTimeoutMs,
} from './policy.js'
import { safeLog } from './http.js'
import { createHealthStore, CREDENTIAL_REF_BACKENDS } from './health.js'
import { createDiagnosticsRing, projectExecution } from './diagnostics.js'

export { DEFAULT_ATTEMPT_TIMEOUT_MS }

/** Router provider id, selected by a profile's `web.searchProvider` pin. */
export const ROUTER_PROVIDER_ID = 'web-search-router'

/**
 * The sequential router. Registered on `ctx.web` as the only search provider;
 * never receives the seam, so provider-to-provider recursion is structurally
 * impossible.
 */
export class SearchRouter {
  /**
   * @param {object} options
   * @param {object[]} [options.adapters] ordered adapter list
   * @param {() => {backends?: {id: string, enabled: boolean}[], attemptTimeoutMs?: number, overallTimeoutMs?: number, maxRetries?: number}} [options.resolveConfiguration]
   *   settings snapshot provider; called ONCE per search (mid-request settings
   *   changes apply to the next search). Its backend order filters/reorders
   *   the adapter chain (unknown ids and unimplemented hops drop out); its
   *   knobs override the constructor values for that search.
   * @param {number} [options.attemptTimeoutMs] per-attempt deadline (default 5 s)
   * @param {number} [options.overallTimeoutMs] whole-search budget (default 15 s)
   * @param {{maxRetries?: number, baseMs?: number, jitterMs?: number, rand?: () => number}} [options.retry]
   * @param {object} [options.logger] host logger (trail on exhaustion)
   * @param {() => number} [options.now] injectable clock
   * @param {{setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}} [options.schedule] injectable scheduler
   * @param {ReturnType<typeof createHealthStore>} [options.health] injectable health store (ticket #88)
   * @param {ReturnType<typeof createDiagnosticsRing>} [options.diagnostics] injectable diagnostics ring
   */
  constructor(options = {}) {
    const {
      adapters = [],
      resolveConfiguration,
      attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
      overallTimeoutMs = DEFAULT_OVERALL_TIMEOUT_MS,
      retry = {},
      logger,
      now = () => Date.now(),
      schedule = { setTimeout, clearTimeout },
      health,
      diagnostics,
    } = options
    this.id = ROUTER_PROVIDER_ID
    this.#adapters = [...adapters]
    this.#byId = new Map(this.#adapters.map((adapter) => [adapter.id, adapter]))
    this.#resolveConfiguration = resolveConfiguration
    this.#attemptTimeoutMs = attemptTimeoutMs
    this.#overallTimeoutMs = overallTimeoutMs
    this.#maxRetries = retry.maxRetries ?? MAX_RETRIES_PER_BACKEND
    this.#retryDelay = retry
    this.#logger = logger
    this.#now = now
    this.#schedule = schedule
    this.#health = health ?? createHealthStore({ now })
    this.#diagnostics = diagnostics ?? createDiagnosticsRing()
  }

  #adapters
  #byId
  #resolveConfiguration
  #attemptTimeoutMs
  #overallTimeoutMs
  #maxRetries
  #retryDelay
  #logger
  #now
  #schedule
  #health
  #diagnostics

  /** Cheap local usability check for the seam (no network probes by contract). */
  available() {
    return this.#adapters.length > 0
  }

  /** Number of adapters currently in the chain (for startup logging). */
  chainSize() {
    return this.#adapters.length
  }

  /** Settings changed: clear every backend's health (#91 wires the onChange hook here). */
  noteSettingsChanged() {
    this.#health.clearAll()
  }

  /**
   * A credential reference changed (`credentials/reference-updated`): clear
   * the affected backend's health so the next search re-attempts it.
   * @param {string} reference e.g. `EXA_API_KEY`
   */
  noteCredentialUpdated(reference) {
    const backend = CREDENTIAL_REF_BACKENDS.get(String(reference))
    if (backend !== undefined) this.#health.clear(backend)
  }

  /** UI-facing health projection (#92 status card): cooling backends only. */
  healthSnapshot() {
    return this.#health.snapshot()
  }

  /** Diagnostics ring copy (oldest first); permitted metadata fields only. */
  diagnosticsSnapshot() {
    return this.#diagnostics.snapshot()
  }

  /**
   * Snapshot one search's chain + knobs: settings backend order filters and
   * reorders the constructor adapters (enabled flag respected, unknown ids and
   * not-yet-implemented hops drop out); knobs fall back to constructor values.
   * A throwing snapshot provider degrades to constructor defaults — settings
   * must never break a search.
   */
  #snapshotConfiguration() {
    let configuration
    if (this.#resolveConfiguration !== undefined) {
      try {
        configuration = this.#resolveConfiguration()
      } catch {
        configuration = undefined
      }
    }
    if (configuration === null || typeof configuration !== 'object') configuration = {}
    let chain = this.#adapters
    if (Array.isArray(configuration.backends)) {
      const byId = this.#byId
      chain = configuration.backends
        .filter((entry) => entry?.enabled !== false && byId.has(entry.id))
        .map((entry) => byId.get(entry.id))
    }
    const knob = (value, fallback) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
    return {
      chain,
      attemptTimeoutMs: knob(configuration.attemptTimeoutMs, this.#attemptTimeoutMs),
      overallTimeoutMs: knob(configuration.overallTimeoutMs, this.#overallTimeoutMs),
      maxRetries: configuration.maxRetries === undefined ? this.#maxRetries : Math.max(0, Math.floor(configuration.maxRetries)),
    }
  }

  /** @param {{query: string, maxResults?: number}} request @param {AbortSignal} [signal] */
  async search(request, signal) {
    if (signal?.aborted) throw new SearchAbortedError()
    const { chain, attemptTimeoutMs, overallTimeoutMs, maxRetries } = this.#snapshotConfiguration()
    const deadlineAt = this.#now() + overallTimeoutMs
    const startedAt = this.#now()
    const trail = []
    try {
      for (const adapter of chain) {
        if (signal?.aborted) throw new SearchAbortedError()
        // Passive health gate: only attempts that START after a cooldown is
        // recorded are affected; in-flight searches elsewhere finish untouched.
        if (this.#health.isCooling(adapter.id)) {
          trail.push({ backend: adapter.id, outcome: 'skipped', reason: 'cooling down' })
          continue
        }
        let status
        try {
          status = adapter.status?.() ?? { ok: true }
          if (status && typeof status.then === 'function') status = await status
        } catch (error) {
          status = { ok: false, reason: `status check failed: ${error?.message ?? 'unknown'}` }
        }
        if (!status?.ok) {
          trail.push({ backend: adapter.id, outcome: 'skipped', reason: status?.reason ?? 'unavailable' })
          continue
        }
        let budgetExhausted = false
        for (let attempt = 0; ; attempt++) {
          if (signal?.aborted) throw new SearchAbortedError()
          const remainingMs = deadlineAt - this.#now()
          if (remainingMs <= 0) {
            trail.push({ backend: adapter.id, outcome: 'skipped', reason: 'overall deadline exhausted' })
            budgetExhausted = true
            break
          }
          const outcome = await this.#attempt(adapter, request, signal, clampAttemptTimeoutMs(attemptTimeoutMs, remainingMs))
          if (outcome.abortedCaller) {
            safeLog(this.#logger, 'info', 'web-search-router: aborted by caller during %s', adapter.id)
            throw new SearchAbortedError()
          }
          if (outcome.ok) {
            trail.push({
              backend: adapter.id,
              outcome: 'served',
              latencyMs: outcome.latencyMs,
              retries: attempt,
              at: this.#now(),
            })
            // Success clears transient health state for the serving backend.
            this.#health.clear(adapter.id)
            this.#diagnostics.record(projectExecution({ startedAt, outcome: 'served', trail }))
            safeLog(this.#logger, 'debug', 'web-search-router: served by %s after %dms', adapter.id, outcome.latencyMs)
            return outcome.result
          }
          const error = outcome.error
          this.#health.recordFailure(adapter.id, error)
          const coolingNow = this.#health.isCooling(adapter.id)
          trail.push({
            backend: adapter.id,
            outcome: 'failed',
            failureClass: error.failureClass,
            ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
            ...(coolingNow ? { cooldownUntil: this.#health.snapshot().find((entry) => entry.id === adapter.id)?.cooldownUntil ?? Number.POSITIVE_INFINITY } : {}),
            latencyMs: outcome.latencyMs,
            retries: attempt,
            at: this.#now(),
            ...(error.message ? { message: error.message } : {}),
          })
          if (attempt >= maxRetries || !isRetryable(error)) break
          const delayMs = error.retryAfterMs !== undefined ? error.retryAfterMs : retryDelayMs(this.#retryDelay)
          // The retry delay must leave budget for the retry attempt itself;
          // a delay that no longer fits skips the retry (rogerdigital pattern).
          if (delayMs > 0 && deadlineAt - this.#now() - delayMs <= 0) break
          if (delayMs > 0) await this.#wait(delayMs, signal)
        }
        if (budgetExhausted) break
      }
      safeLog(this.#logger, 'info', 'web-search-router: chain exhausted: %j', trail)
      this.#diagnostics.record(projectExecution({ startedAt, outcome: 'exhausted', trail }))
      throw new ChainExhaustedError(trail)
    } catch (error) {
      // Caller aborts are recorded as executions but never as backend failures.
      if (error instanceof SearchAbortedError) {
        this.#diagnostics.record(projectExecution({ startedAt, outcome: 'aborted', trail }))
      }
      throw error
    }
  }

  /**
   * Run one adapter attempt under a deadline-clamped attempt signal.
   * Returns `{ok, result, latencyMs}` on success, `{abortedCaller: true}` when
   * the caller cancelled (never a backend failure), or `{ok: false, error,
   * latencyMs}` with the error already classified as an AdapterError.
   */
  async #attempt(adapter, request, signal, attemptTimeoutMs) {
    const startedAt = this.#now()
    const controller = new AbortController()
    const timer = this.#schedule.setTimeout(() => controller.abort(), attemptTimeoutMs)
    let attemptSignal = controller.signal
    if (signal !== undefined) attemptSignal = AbortSignal.any([signal, controller.signal])
    try {
      const result = await adapter.search(request, attemptSignal)
      return { ok: true, result, latencyMs: this.#now() - startedAt }
    } catch (error) {
      if (isAbortLike(error)) {
        if (signal?.aborted) return { abortedCaller: true }
        return {
          ok: false,
          latencyMs: this.#now() - startedAt,
          error: new AdapterError(`${adapter.id}: attempt timed out after ${attemptTimeoutMs}ms`, 'timeout'),
        }
      }
      return {
        ok: false,
        latencyMs: this.#now() - startedAt,
        error:
          error instanceof AdapterError
            ? error
            : new AdapterError(`${adapter.id}: unexpected failure`, 'upstream', { cause: error }),
      }
    } finally {
      this.#schedule.clearTimeout(timer)
    }
  }

  /** Abortable wait through the injected scheduler; caller abort wins mid-delay. */
  #wait(delayMs, signal) {
    return new Promise((resolve, reject) => {
      const timer = this.#schedule.setTimeout(() => resolve(), delayMs)
      const onAbort = () => {
        this.#schedule.clearTimeout(timer)
        reject(new SearchAbortedError())
      }
      if (signal !== undefined) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }
}
