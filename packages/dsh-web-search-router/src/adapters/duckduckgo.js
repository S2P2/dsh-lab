/**
 * DuckDuckGo HTML adapter — the keyless final backend of the chain.
 *
 * Speaks the `html.duckduckgo.com/html/` endpoint, decodes `uddg` redirect
 * wrappers, and detects the anti-bot challenge (HTTP 202 or the challenge
 * page) as a rate-limit failure instead of an empty result. HTML parsing
 * adapted from PR #9's backends.js, which adapted 240xu/dsh-websearch (MIT).
 *
 * The adapter never creates its own timers: the router walk owns attempt
 * deadlines and passes a composed signal; this module only classifies what
 * it observes (network vs abort vs wire shape) into the failure vocabulary.
 * @module
 */
import { AdapterError } from '../errors.js'
import { parseRetryAfterMs, statusFailureClass, translateFetchError } from '../http.js'
import { normalizeResult } from '../normalize.js'

export const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'
const USER_AGENT = 'deepseek-harness/web-search-router'

/** Strip tags and collapse whitespace in a title/snippet fragment. */
function stripTags(value) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Resolve a DDG redirect wrapper (`//duckduckgo.com/l/?uddg=…`) to its target URL. */
export function extractDdgUrl(href) {
  if (typeof href !== 'string' || href.length === 0) return undefined
  let value = href
  if (value.startsWith('//')) value = `https:${value}`
  try {
    const url = new URL(value, 'https://duckduckgo.com')
    const target = url.searchParams.get('uddg')
    const candidate = target ?? url.toString()
    const usable = new URL(candidate)
    return usable.protocol === 'https:' || usable.protocol === 'http:' ? usable.toString() : undefined
  } catch {
    return undefined
  }
}

/** Parse a DDG HTML results page into raw sources (order preserved, pre-normalization). */
export function parseDdgHtml(html) {
  const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? []
  const sources = []
  for (const block of blocks) {
    const href = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/)?.[1]
    const url = extractDdgUrl(href)
    if (url === undefined) continue
    const title = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/)?.[1]
    const snippet = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/)?.[1]
    sources.push({
      url,
      ...(title ? { title: stripTags(title) } : {}),
      ...(snippet ? { snippet: stripTags(snippet) } : {}),
    })
  }
  return sources
}

/** True when the response body looks like DDG's anti-bot challenge. */
function isAntiBotChallenge(status, html) {
  return status === 202 || /anomaly|captcha|unusual traffic|robot check/i.test(html.slice(0, 4000))
}

/**
 * Create the DuckDuckGo adapter.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] injected for hermetic tests
 */
export function createDuckduckgoAdapter(options = {}) {
  const { fetchImpl = fetch } = options
  const id = 'duckduckgo'
  return {
    id,
    /** Cheap local status: keyless, always ready (no network probes by contract). */
    status() {
      return { ok: true, state: 'ready' }
    },
    /** @param {{query: string, maxResults?: number}} request @param {AbortSignal} attemptSignal */
    async search(request, attemptSignal) {
      const target = `${DDG_HTML_URL}?${new URLSearchParams({ q: request.query })}`
      let response
      try {
        response = await fetchImpl(target, {
          redirect: 'follow',
          headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
          signal: attemptSignal,
        })
      } catch (error) {
        throw translateFetchError(error, id)
      }
      let html
      try {
        html = await response.text()
      } catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
          throw translateFetchError(error, id)
        }
        throw new AdapterError(`${id}: response body unreadable`, 'malformed', { cause: error })
      }
      if (isAntiBotChallenge(response.status, html)) {
        throw new AdapterError(`${id}: rate-limited (anti-bot challenge)`, 'rate_limit')
      }
      if (!response.ok) {
        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'))
        throw new AdapterError(
          `${id}: HTTP ${response.status}`,
          statusFailureClass(response.status),
          retryAfterMs !== undefined ? { retryAfterMs } : {},
        )
      }
      return normalizeResult({ sources: parseDdgHtml(html) }, request.maxResults)
    },
  }
}
