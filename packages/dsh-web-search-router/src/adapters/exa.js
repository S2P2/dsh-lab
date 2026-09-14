/**
 * Exa adapter — the first keyed REST hop of the chain (spec #8, ticket #89).
 *
 * Speaks `api.exa.ai/search` with Bearer authorization and the proven PR #9
 * wire shape (highlights requested via `contents`, `numResults` only when the
 * caller capped results). Wire facts verified against PR #9's backends.js,
 * which was live-tested. The API key resolves PER SEARCH OPERATION through
 * the injected `resolveExaKey` seam — never cached here, never read from
 * `process.env` (the DSH credentials service layers env/store/`.env`), and
 * never echoed into errors, trails, or logs: an unconfigured reference fails
 * `config` with zero network attempts, naming the reference only.
 *
 * Like every adapter it creates no timers: the router walk owns attempt
 * deadlines and passes the composed signal.
 * @module
 */
import { AdapterError } from '../errors.js'
import { readJsonResultsBody, translateFetchError, translateResponseStatus } from '../http.js'
import { normalizeResult } from '../normalize.js'

export const EXA_SEARCH_URL = 'https://api.exa.ai/search'
const USER_AGENT = 'deepseek-harness/web-search-router'

/** Exa's fixed credential reference (resolved through the credentials seam). */
export const EXA_KEY_REFERENCE = 'EXA_API_KEY'

/** True for a usable resolved key: a non-empty string. Anything else is unconfigured. */
function usableKey(key) {
  return typeof key === 'string' && key.trim().length > 0
}

/**
 * Map one Exa result item to a raw source (pre-normalization; normalizeResult
 * drops unusable URLs and keeps url-only results — only the URL is required).
 * Snippet prefers the first non-empty highlight, falling back to `text`.
 * @param {object} item
 */
function mapExaResult(item) {
  const highlight = Array.isArray(item?.highlights)
    ? item.highlights.find((value) => typeof value === 'string' && value.length > 0)
    : undefined
  const snippet = highlight ?? (typeof item?.text === 'string' ? item.text : undefined)
  return {
    url: item?.url,
    ...(typeof item?.title === 'string' && item.title.length > 0 ? { title: item.title } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(typeof item?.publishedDate === 'string' && item.publishedDate.length > 0
      ? { publishedAt: item.publishedDate }
      : {}),
  }
}

/**
 * Create the Exa adapter.
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl] injected for hermetic tests
 * @param {() => Promise<string | undefined>} [deps.resolveExaKey] per-operation key resolver
 */
export function createExaAdapter(deps = {}) {
  const { fetchImpl = fetch, resolveExaKey } = deps
  const id = 'exa'
  return {
    id,
    /**
     * Cheap local status only: key resolution is a per-search-operation
     * concern (the settings ticket wires the describe-based probe later).
     */
    status() {
      return { ok: true, state: 'ready' }
    },
    /** @param {{query: string, maxResults?: number}} request @param {AbortSignal} attemptSignal */
    async search(request, attemptSignal) {
      const key = await resolveExaKey?.()
      if (!usableKey(key)) {
        throw new AdapterError(`${id}: ${EXA_KEY_REFERENCE} not configured`, 'config')
      }
      const body = {
        query: request.query,
        type: 'auto',
        contents: { highlights: { highlightsPerUrl: 1 } },
        ...(request.maxResults !== undefined ? { numResults: request.maxResults } : {}),
      }
      let response
      try {
        response = await fetchImpl(EXA_SEARCH_URL, {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': USER_AGENT,
          },
          body: JSON.stringify(body),
          signal: attemptSignal,
        })
      } catch (error) {
        throw translateFetchError(error, id)
      }
      if (!response.ok) throw translateResponseStatus(id, response)
      const payload = await readJsonResultsBody(response, id)
      return normalizeResult({ sources: payload.results.map(mapExaResult) }, request.maxResults)
    },
  }
}
