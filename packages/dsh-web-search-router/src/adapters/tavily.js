/**
 * Tavily adapter — the second keyed REST hop of the chain (spec #8, ticket #89).
 *
 * Speaks `api.tavily.com/search` with Bearer authorization and the proven
 * PR #9 wire shape (`max_results` clamped to Tavily's 20-result cap, basic
 * search depth). Wire facts verified against PR #9's backends.js, which was
 * live-tested. The API key resolves PER SEARCH OPERATION through the
 * injected `resolveTavilyKey` seam — never cached here, never read from
 * `process.env` (the DSH credentials service layers env/store/`.env`), and
 * never echoed into errors, trails, or logs: an unconfigured reference fails
 * `config` with zero network attempts, naming the reference only.
 *
 * Mapping: the provider `answer` summary becomes the result `content`;
 * `results[]` become sources (`content` → snippet, `published_date` →
 * publishedAt); url-only results survive — only the URL is required.
 *
 * Like every adapter it creates no timers: the router walk owns attempt
 * deadlines and passes the composed signal.
 * @module
 */
import { AdapterError } from '../errors.js'
import { readJsonResultsBody, translateFetchError, translateResponseStatus, usableCredential } from '../http.js'
import { normalizeResult } from '../normalize.js'

export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

/** Tavily's fixed credential reference (resolved through the credentials seam). */
export const TAVILY_KEY_REFERENCE = 'TAVILY_API_KEY'

/** Tavily's server-side cap on `max_results` (PR #9's proven clamp). */
const TAVILY_MAX_RESULTS_CAP = 20

/** Map one Tavily result item to a raw source (pre-normalization; only url is required). */
function mapTavilyResult(item) {
  return {
    url: item?.url,
    ...(typeof item?.title === 'string' && item.title.length > 0 ? { title: item.title } : {}),
    ...(typeof item?.content === 'string' && item.content.length > 0 ? { snippet: item.content } : {}),
    ...(typeof item?.published_date === 'string' && item.published_date.length > 0
      ? { publishedAt: item.published_date }
      : {}),
  }
}

/**
 * Create the Tavily adapter.
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl] injected for hermetic tests
 * @param {() => Promise<string | undefined>} [deps.resolveTavilyKey] per-operation key resolver
 */
export function createTavilyAdapter(deps = {}) {
  const { fetchImpl = fetch, resolveTavilyKey } = deps
  const id = 'tavily'
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
      const key = await resolveTavilyKey?.()
      if (!usableCredential(key)) {
        throw new AdapterError(`${id}: ${TAVILY_KEY_REFERENCE} not configured`, 'config')
      }
      const body = {
        query: request.query,
        max_results: Math.min(request.maxResults ?? 5, TAVILY_MAX_RESULTS_CAP),
        search_depth: 'basic',
      }
      let response
      try {
        response = await fetchImpl(TAVILY_SEARCH_URL, {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: attemptSignal,
        })
      } catch (error) {
        throw translateFetchError(error, id)
      }
      if (!response.ok) throw translateResponseStatus(id, response)
      const payload = await readJsonResultsBody(response, id)
      return normalizeResult(
        {
          content: typeof payload.answer === 'string' ? payload.answer : undefined,
          sources: payload.results.map(mapTavilyResult),
        },
        request.maxResults,
      )
    },
  }
}
