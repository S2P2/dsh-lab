/**
 * The routing WebSearchProvider core: walks internal adapters sequentially,
 * stops at the first structurally valid result, treats caller abort as
 * terminal cancellation that never records a backend failure, and surfaces
 * chain exhaustion as one sanitized model-facing error with the detailed
 * ordered trail going to the host logger only (spec #8).
 *
 * The walk owns attempt deadlines (minimal per-attempt timeout here; the
 * full 15 s overall budget + retry policy lands with #87 behind the same
 * `schedule`/`now` seams). No DSH imports: this module is the hermetic test
 * seam, constructed with fake adapters.
 * @module
 */
import {
  AdapterError,
  SearchAbortedError,
  ChainExhaustedError,
} from './errors.js'
import { isAbortLike } from './http.js'

/** Router provider id, selected by a profile's `web.searchProvider` pin. */
export const ROUTER_PROVIDER_ID = 'web-search-router'

/** Minimal per-attempt cap; #87 layers the overall budget and remaining-budget clamping on top. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 5_000

/** Never-throw host logging (240xu pattern: emitters are best-effort). */
function safeLog(logger, level, format, ...args) {
  try {
    logger?.[level]?.(format, ...args)
  } catch {
    /* host logging must never break search */
  }
}

/**
 * The sequential router. Registered on `ctx.web` as the only search provider;
 * never receives the seam, so provider-to-provider recursion is structurally
 * impossible.
 */
export class SearchRouter {
  /** @param {object} options @param {object[]} [options.adapters] ordered adapter list
   *  @param {number} [options.attemptTimeoutMs] per-attempt deadline
   *  @param {object} [options.logger] host logger (trail on exhaustion)
   *  @param {() => number} [options.now] injectable clock
   *  @param {{setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}} [options.schedule] injectable scheduler */
  constructor(options = {}) {
    const {
      adapters = [],
      attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
      logger,
      now = () => Date.now(),
      schedule = { setTimeout, clearTimeout },
    } = options
    this.id = ROUTER_PROVIDER_ID
    this.#adapters = [...adapters]
    this.#attemptTimeoutMs = attemptTimeoutMs
    this.#logger = logger
    this.#now = now
    this.#schedule = schedule
  }

  #adapters
  #attemptTimeoutMs
  #logger
  #now
  #schedule

  /** Cheap local usability check for the seam (no network probes by contract). */
  available() {
    return this.#adapters.length > 0
  }

  /** Number of adapters currently in the chain (for startup logging). */
  chainSize() {
    return this.#adapters.length
  }

  /** @param {{query: string, maxResults?: number}} request @param {AbortSignal} [signal] */
  async search(request, signal) {
    if (signal?.aborted) throw new SearchAbortedError()
    const trail = []
    for (const adapter of this.#adapters) {
      if (signal?.aborted) throw new SearchAbortedError()
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
      const result = await this.#attempt(adapter, request, signal, trail)
      if (result !== undefined) {
        safeLog(this.#logger, 'debug', 'web-search-router: served by %s after %dms', adapter.id, trail.at(-1)?.latencyMs)
        return result
      }
      if (signal?.aborted) throw new SearchAbortedError() // abort surfaced mid-attempt
    }
    safeLog(this.#logger, 'info', 'web-search-router: chain exhausted: %j', trail)
    throw new ChainExhaustedError(trail)
  }

  /**
   * Run one adapter attempt under the per-attempt deadline. Returns the
   * result on success, undefined after a classified failure (recorded in the
   * trail), throws SearchAbortedError on caller cancellation. Caller abort
   * is never recorded as a backend failure.
   */
  async #attempt(adapter, request, signal, trail) {
    const startedAt = this.#now()
    const controller = new AbortController()
    const timer = this.#schedule.setTimeout(() => controller.abort(), this.#attemptTimeoutMs)
    let attemptSignal = controller.signal
    if (signal !== undefined) attemptSignal = AbortSignal.any([signal, controller.signal])
    try {
      return await adapter.search(request, attemptSignal)
    } catch (error) {
      if (isAbortLike(error)) {
        if (signal?.aborted) {
          safeLog(this.#logger, 'info', 'web-search-router: aborted by caller during %s', adapter.id)
          throw new SearchAbortedError()
        }
        trail.push({
          backend: adapter.id,
          outcome: 'failed',
          failureClass: 'timeout',
          latencyMs: this.#now() - startedAt,
          at: this.#now(),
        })
        return undefined
      }
      const failureClass = error instanceof AdapterError ? error.failureClass : 'upstream'
      trail.push({
        backend: adapter.id,
        outcome: 'failed',
        failureClass,
        ...(error instanceof AdapterError && error.retryAfterMs !== undefined
          ? { retryAfterMs: error.retryAfterMs }
          : {}),
        latencyMs: this.#now() - startedAt,
        at: this.#now(),
        ...(error instanceof Error && error.message ? { message: error.message } : {}),
      })
      return undefined
    } finally {
      this.#schedule.clearTimeout(timer)
    }
  }
}
