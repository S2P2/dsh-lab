/**
 * Closed failure vocabulary and error shapes for the web search router.
 *
 * Two layers:
 * - Adapter-internal: `AdapterError` carries a `failureClass` from the closed
 *   vocabulary below plus retry signals for the router's failure policy.
 *   `AdapterAbortError` marks an aborted *attempt signal*; the router walk
 *   classifies it (caller abort vs attempt deadline) because only the walk
 *   knows which one fired.
 * - Model-facing: `SearchAbortedError` (caller cancellation, terminal) and
 *   `ChainExhaustedError` (every usable backend failed). Both carry a `code`
 *   in the stock web-seam convention (open-string codes; consumers tolerate
 *   provider-specific ones), so the package needs no DSH imports and the
 *   whole suite stays hermetic. The exhaustion message is deliberately
 *   sanitized: no upstream text reaches the model; the detailed ordered
 *   trail rides `error.trail` and the host logger only.
 * @module
 */

/** The closed internal failure vocabulary (spec #8). */
export const FAILURE_CLASSES = [
  'config',
  'auth',
  'quota',
  'rate_limit',
  'timeout',
  'network',
  'upstream',
  'malformed',
  'empty',
]

/**
 * A classified, adapter-owned failure.
 * Adapters translate provider-specific behavior into this shape; the router
 * never parses provider messages.
 */
export class AdapterError extends Error {
  /** @param {string} message @param {string} failureClass @param {object} [options] */
  constructor(message, failureClass, options = {}) {
    super(message, { cause: options.cause })
    if (!FAILURE_CLASSES.includes(failureClass)) {
      throw new Error(`web-search-router: unknown failure class "${failureClass}"`)
    }
    this.name = 'AdapterError'
    this.failureClass = failureClass
    /** Whether the router's one-retry transient policy may retry this failure. */
    this.retryable = options.retryable === true
    /** Provider-supplied cooldown hint in milliseconds, when structured. */
    this.retryAfterMs = typeof options.retryAfterMs === 'number' ? options.retryAfterMs : undefined
  }
}

/**
 * The composed attempt signal aborted. Carries no failure class on purpose:
 * the router walk decides caller-abort (terminal, never a backend failure)
 * vs attempt-deadline (classified `timeout`).
 */
export class AdapterAbortError extends Error {
  constructor(cause) {
    super('search attempt aborted', { cause })
    this.name = 'AdapterAbortError'
  }
}

/** Caller cancellation: terminal, never recorded as a backend failure, never triggers fallback. */
export class SearchAbortedError extends Error {
  constructor() {
    super('web search aborted by caller')
    this.name = 'SearchAbortedError'
    /** Stock web-seam cancellation code (open-string convention). */
    this.code = 'WEB_ABORTED'
  }
}

/** Chain exhaustion: every usable backend failed or the chain is empty. Sanitized model-facing message. */
export class ChainExhaustedError extends Error {
  /** @param {object[]} trail ordered operator-facing attempt summaries */
  constructor(trail = []) {
    super('no configured search backend succeeded')
    this.name = 'ChainExhaustedError'
    this.code = 'WEB_PROVIDER_ERROR'
    this.trail = trail
  }
}
