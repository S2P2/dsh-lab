/**
 * Small shared HTTP helpers for REST-ish adapters (DDG now; Exa/Tavily keyed
 * REST response translation here). No DSH imports; adapters own their wire
 * translation into AdapterError shapes.
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

/** Statuses treated as transient transport failures (retry-worthy): only these. */
export const TRANSIENT_UPSTREAM_STATUSES = new Set([502, 503, 504])

/** Never-throw host logging (240xu pattern: emitters are best-effort). */
export function safeLog(logger, level, format, ...args) {
  try {
    logger?.[level]?.(format, ...args)
  } catch {
    /* host logging must never break search */
  }
}

/** True for a usable resolved credential: a non-empty string. Anything else is unconfigured. */
export function usableCredential(key) {
  return typeof key === 'string' && key.trim().length > 0
}

/**
 * Translate a non-2xx keyed-REST response into a classified AdapterError:
 * status → failure class, `Retry-After` → structured `retryAfterMs`, and
 * retryable ONLY for the 502/503/504 set (transient transport equivalence —
 * a plain 500 is upstream but not transport-transient). The message carries
 * the status alone: no upstream body text (and therefore no secret echo).
 * @param {string} id backend id for message context
 * @param {{status: number, headers?: {get?: (name: string) => string | null}}} response
 */
export function translateResponseStatus(id, response) {
  const options = {}
  if (TRANSIENT_UPSTREAM_STATUSES.has(response.status)) options.retryable = true
  const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'))
  if (retryAfterMs !== undefined) options.retryAfterMs = retryAfterMs
  return new AdapterError(`${id}: HTTP ${response.status}`, statusFailureClass(response.status), options)
}

/**
 * Read a keyed-REST JSON response body and shape-check it as `{ results: [] }`
 * (the Exa/Tavily envelope). Invalid JSON or a wrong shape is `malformed`;
 * an aborted body read stays an abort for the walk to classify. A valid but
 * empty `results` array flows onward — normalizeResult owns the `empty` failure.
 * @param {{json: () => Promise<unknown>}} response @param {string} id
 * @returns {Promise<{results: unknown[]}>}
 */
export async function readJsonResultsBody(response, id) {
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new AdapterAbortError(error)
    }
    throw new AdapterError(`${id}: response body was not valid JSON`, 'malformed', { cause: error })
  }
  if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.results)) {
    throw new AdapterError(`${id}: response had no results array`, 'malformed')
  }
  return payload
}

/** True when an error looks like an abort of an attempt signal (defensive walk-side check). */
export function isAbortLike(error) {
  return (
    error instanceof AdapterAbortError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (error instanceof Error && error.message === 'This operation was aborted')
  )
}
