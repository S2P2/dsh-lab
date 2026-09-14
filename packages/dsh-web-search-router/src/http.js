/**
 * Small shared HTTP helpers for REST-ish adapters (DDG now; Exa/Tavily/SearXNG later).
 * No DSH imports; adapters own their wire translation into AdapterError shapes.
 * @module
 */
import { AdapterError, AdapterAbortError } from './errors.js'

/**
 * Parse a `Retry-After` header value (delta-seconds or HTTP-date) to milliseconds.
 * Returns undefined for absent/unparseable values. (Adapted from PR #9's
 * backends.js, which adapted 240xu/dsh-websearch, MIT.)
 * @param {string | undefined} value @param {() => number} [now]
 */
export function parseRetryAfterMs(value, now = () => Date.now()) {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now())
}

/**
 * Map an HTTP status to the closed failure vocabulary.
 * 401/403 auth · 429 rate_limit · >=500 upstream · other non-2xx upstream.
 */
export function statusFailureClass(status) {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  return 'upstream'
}

/**
 * Translate a thrown fetch-layer exception into the adapter error shapes.
 * Abort-like rejections become AdapterAbortError (the walk classifies them);
 * network TypeErrors become `network`; anything unexpected stays upstream-ish
 * without leaking provider text into the class decision.
 * @param {unknown} error @param {string} id backend id for message context
 */
export function translateFetchError(error, id) {
  if (error instanceof AdapterError || error instanceof AdapterAbortError) return error
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new AdapterAbortError(error)
  }
  if (error instanceof TypeError) {
    return new AdapterError(`${id}: network request failed`, 'network', { cause: error, retryable: true })
  }
  return new AdapterError(`${id}: request failed`, 'upstream', { cause: error })
}

/** True when an error looks like an abort of an attempt signal (defensive walk-side check). */
export function isAbortLike(error) {
  return (
    error instanceof AdapterAbortError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (error instanceof Error && error.message === 'This operation was aborted')
  )
}
