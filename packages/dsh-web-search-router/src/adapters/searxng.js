/**
 * SearXNG adapter — one configured self-hosted instance (ticket #90).
 *
 * Speaks the JSON search API (`GET {base}/search?q=…&format=json`) of
 * exactly ONE explicitly configured instance. The single-URL policy holds
 * structurally: the base URL arrives per search operation from the injected
 * `getSearxngBaseUrl` thunk (the settings snapshot's `searxngBaseUrl`),
 * is validated locally, and is the one and only request origin — there is
 * no fallback list here, no discovery, nothing to iterate, and no baked-in
 * public default (PR #9's fallback behavior is deliberately NOT adapted).
 *
 * Base-URL validation adapts rogerdigital/dsh-searxng's rules: absolute
 * HTTP(S) URL, no query, no fragment, no credentials in the authority.
 * An absent or invalid URL means needs-setup / a `config` failure with
 * ZERO network attempts — status() is cheap and local by construction.
 *
 * Practical diagnostics (messages are operator-facing; they never reach the
 * model): 403 usually means the instance disabled the JSON response format,
 * and 429 carries the `Retry-After` header as structured `retryAfterMs`
 * input for the failure policy's cooldown. Like every adapter it creates
 * no timers — the router walk owns deadlines.
 * @module
 */
import { AdapterError } from '../errors.js'
import { readJsonResultsBody, translateFetchError, translateResponseStatus } from '../http.js'
import { normalizeResult } from '../normalize.js'

const USER_AGENT = 'deepseek-harness/web-search-router'

/**
 * Validate and normalize the configured base URL into the single request
 * origin (`scheme://host[:port][/path]`, trailing slashes stripped so a
 * sub-path deployment still yields `{base}/search`). Returns undefined for
 * anything the single-URL policy rejects.
 * @param {unknown} candidate
 * @returns {string | undefined}
 */
function normalizeBaseUrl(candidate) {
  if (typeof candidate !== 'string') return undefined
  const trimmed = candidate.trim()
  if (trimmed.length === 0) return undefined
  let url
  try {
    url = new URL(trimmed)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  if (url.search !== '' || url.hash !== '') return undefined
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

/** Epoch-seconds date (SearXNG's JSON serialization) as ISO text, undefined when out of range. */
function epochToIso(epochSeconds) {
  const date = new Date(epochSeconds * 1000)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * Map one SearXNG JSON result onto a raw source (pre-normalization):
 * `content` → snippet, `publishedDate` → publishedAt (string values pass
 * through; epoch-second numbers become ISO text).
 * @param {object} item
 */
function mapSearxngResult(item) {
  const published = item?.publishedDate
  const publishedAt =
    typeof published === 'string' && published.length > 0
      ? published
      : typeof published === 'number' && Number.isFinite(published)
        ? epochToIso(published)
        : undefined
  return {
    url: item?.url,
    ...(typeof item?.title === 'string' && item.title.length > 0 ? { title: item.title } : {}),
    ...(typeof item?.content === 'string' && item.content.length > 0 ? { snippet: item.content } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  }
}

/**
 * Create the SearXNG adapter.
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl] injected for hermetic tests
 * @param {() => string | Promise<string>} [deps.getSearxngBaseUrl] settings thunk returning the ONE
 *   configured base URL ('' or undefined when absent); sync or async, called
 *   per search operation and by status() — both cheaply and locally
 */
export function createSearxngAdapter(deps = {}) {
  const { fetchImpl = fetch, getSearxngBaseUrl = () => '' } = deps
  const id = 'searxng'

  async function resolveBase() {
    let candidate
    try {
      candidate = await getSearxngBaseUrl()
    } catch {
      return undefined // the settings snapshot never throws; defensive only
    }
    return normalizeBaseUrl(candidate)
  }

  /** HTTP-level failure: 403 carries the JSON-format hint; the rest delegates to the shared translation. */
  function httpFailure(response) {
    if (response.status === 403) {
      return new AdapterError(
        `${id}: HTTP 403 — SearXNG usually returns this when the JSON response format is disabled for the instance (enable "json" under search.formats in its settings.yml)`,
        'auth',
      )
    }
    return translateResponseStatus(id, response)
  }

  return {
    id,
    /**
     * Cheap local status ONLY (acceptance criterion): reads the injected
     * thunk and validates the URL shape — no fetch, no probes, zero
     * network calls whether the URL is configured or not.
     */
    async status() {
      return (await resolveBase()) === undefined
        ? { ok: false, reason: 'no base URL configured', state: 'needs-setup' }
        : { ok: true, state: 'ready' }
    },
    /** @param {{query: string, maxResults?: number}} request @param {AbortSignal} attemptSignal */
    async search(request, attemptSignal) {
      const base = await resolveBase()
      if (base === undefined) {
        throw new AdapterError(`${id}: no base URL configured`, 'config')
      }
      const params = new URLSearchParams({ q: request.query, format: 'json' })
      let response
      try {
        response = await fetchImpl(`${base}/search?${params}`, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          signal: attemptSignal,
        })
      } catch (error) {
        throw translateFetchError(error, id)
      }
      if (!response.ok) throw httpFailure(response)
      const payload = await readJsonResultsBody(response, id)
      // Provider-level instant answers are preserved as result `content`
      // (normalizeResult keeps it); sources still decide success.
      const answers = Array.isArray(payload.answers)
        ? payload.answers.filter((answer) => typeof answer === 'string' && answer.trim().length > 0)
        : []
      return normalizeResult(
        {
          ...(answers.length > 0 ? { content: answers.join('\n\n') } : {}),
          sources: payload.results.map(mapSearxngResult),
        },
        request.maxResults,
      )
    },
  }
}
