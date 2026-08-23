/**
 * dsh-web-search-router — backend wire calls.
 *
 * Each factory returns an internal backend `{ id, availability(), search() }`:
 * `availability()` is a cheap local check (config/key/credential presence —
 * never a network call), `search()` performs one upstream request. Wire errors
 * carry `.status` (HTTP number when known) and `.retryAfterMs` (parsed
 * `Retry-After` on 429) so the router core can rotate and cool down. All
 * upstream shapes were audited from the sources cited per backend; `fetchImpl`
 * is injectable so tests run hermetically without sockets.
 * @module
 */

/** Wire endpoint of the Codex standalone search (dsh-codex prior art). */
export const CODEX_SEARCH_URL = 'https://chatgpt.com/backend-api/codex/alpha/search'

/** z.ai Web Search REST endpoint (docs.z.ai/api-reference/tools/web-search). */
export const ZAI_SEARCH_URL = 'https://api.z.ai/api/paas/v4/web_search'

/** Exa search endpoint. */
export const EXA_SEARCH_URL = 'https://api.exa.ai/search'

/** Tavily search endpoint. */
export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

/** DuckDuckGo HTML endpoint. */
export const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'

/** Public SearXNG instances tried in order when none are configured. */
export const SEARXNG_INSTANCES = ['https://searx.be', 'https://priv.au', 'https://search.inetol.net']

const USER_AGENT = 'deepseek-harness/web-search-router'
const DEFAULT_TIMEOUT_MS = 15_000

/** Compose the caller's signal with a per-attempt timeout, tolerating absence. */
function attemptSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/** True for native fetch cancellation/timeout rejections. */
function isAbortError(error) {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/** Rethrow abort/timeout failures with a backend-labelled message. */
function labelAbort(error, id, timeoutMs) {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return Object.assign(new Error(`${id} timed out after ${timeoutMs}ms`), { cause: error })
  }
  if (isAbortError(error) || error instanceof Error && error.message === 'This operation was aborted') {
    return Object.assign(new Error(`${id} aborted`), { cause: error })
  }
  return error
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) to milliseconds. */
export function parseRetryAfterMs(value) {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

/** Throw a typed wire failure for a non-2xx JSON response. */
async function throwHttpResponse(id, response) {
  let detail = ''
  try {
    const payload = await response.json()
    const message = payload?.error?.message ?? payload?.message
    if (typeof message === 'string') detail = message.slice(0, 200)
  } catch {
    /* non-JSON body: status alone is enough */
  }
  const error = new Error(`${id} failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
  error.status = response.status
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'))
    if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs
  }
  throw error
}

/** Drop sources beyond maxResults and set the truncated flag. */
function capSources(sources, maxResults) {
  if (maxResults === undefined || sources.length <= maxResults) return { sources, truncated: false }
  return { sources: sources.slice(0, maxResults), truncated: true }
}

/** Keep only http(s) URLs. */
function citeableUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Codex backend over the standalone search endpoint. Auth comes from the
 * shared dsh-codex OAuth document (see codex-auth.js); `getAuth` may refresh
 * the token through pi-ai's store, `hasCredential` is the cheap local check.
 */
export function createCodexBackend(options) {
  const {
    getAuth,
    hasCredential,
    model = 'gpt-5.6-sol',
    mode = 'cached',
    contextSize = 'medium',
    maxOutputTokens = 10_000,
    requestId = () => `dsh-web-search-router-${Date.now()}`,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options
  const id = 'codex'
  return {
    id,
    async availability() {
      if (hasCredential !== undefined) {
        const present = await hasCredential()
        return present ? { ok: true } : { ok: false, reason: 'signed out of OpenAI Codex' }
      }
      return { ok: true }
    },
    async search(request, signal) {
      const auth = await getAuth()
      const access = auth?.access
      if (access === undefined) throw Object.assign(new Error(`${id} is signed out of OpenAI Codex`), { status: 401 })
      const body = {
        id: requestId(),
        model,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: request.query }] }],
        commands: { search_query: [{ q: request.query }] },
        settings: {
          search_context_size: contextSize,
          allowed_callers: ['direct'],
          external_web_access: mode === 'live' ? true : mode === 'indexed' ? 'indexed' : false,
        },
        max_output_tokens: maxOutputTokens,
      }
      let response
      try {
        response = await fetchImpl(CODEX_SEARCH_URL, {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${access}`,
            'chatgpt-account-id': auth.accountId,
            'content-type': 'application/json',
            accept: 'application/json',
            originator: 'deepseek-harness',
          },
          body: JSON.stringify(body),
          signal: attemptSignal(signal, timeoutMs),
        })
      } catch (error) {
        throw labelAbort(error, id, timeoutMs)
      }
      if (!response.ok) await throwHttpResponse(id, response)
      const payload = await response.json()
      if (typeof payload.output !== 'string') {
        throw new Error(`${id} returned a search response without string output`)
      }
      const seen = new Set()
      const sources = []
      for (const item of payload.results ?? []) {
        if (item?.type !== 'text_result') continue
        const url = citeableUrl(item.url)
        if (url === undefined || seen.has(url)) continue
        seen.add(url)
        sources.push({
          url,
          ...(typeof item.title === 'string' && item.title ? { title: item.title } : {}),
          ...(typeof item.snippet === 'string' && item.snippet ? { snippet: item.snippet } : {}),
        })
      }
      return { ...(payload.output === '' ? {} : { content: payload.output }), ...capSources(sources, request.maxResults) }
    },
  }
}

/** z.ai backend over the documented Web Search REST endpoint. */
export function createZaiBackend(options) {
  const {
    resolveKey,
    apiKeyEnv = 'ZAI_API_KEY',
    engine = 'search-prime',
    apiUrl = ZAI_SEARCH_URL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options
  const id = 'zai'
  return {
    id,
    async availability() {
      const key = await resolveKey()
      return key ? { ok: true } : { ok: false, reason: `missing ${apiKeyEnv}` }
    },
    async search(request, signal) {
      const key = await resolveKey()
      if (!key) throw Object.assign(new Error(`${id} requires ${apiKeyEnv}`), { status: 401 })
      const body = {
        search_engine: engine,
        search_query: request.query,
        count: Math.min(request.maxResults ?? 10, 50),
      }
      let response
      try {
        response = await fetchImpl(apiUrl, {
          method: 'POST',
          redirect: 'error',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal: attemptSignal(signal, timeoutMs),
        })
      } catch (error) {
        throw labelAbort(error, id, timeoutMs)
      }
      if (!response.ok) await throwHttpResponse(id, response)
      const payload = await response.json()
      const sources = []
      const seen = new Set()
      for (const item of payload.search_result ?? []) {
        const url = citeableUrl(item?.link)
        if (url === undefined || seen.has(url)) continue
        seen.add(url)
        sources.push({
          url,
          ...(typeof item.title === 'string' && item.title ? { title: item.title } : {}),
          ...(typeof item.content === 'string' && item.content ? { snippet: item.content } : {}),
          ...(typeof item.publish_date === 'string' && item.publish_date ? { publishedAt: item.publish_date } : {}),
        })
      }
      return capSources(sources, request.maxResults)
    },
  }
}

/** Exa backend (keyed). */
export function createExaBackend(options) {
  const { resolveKey, apiKeyEnv = 'EXA_API_KEY', apiUrl = EXA_SEARCH_URL, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const id = 'exa'
  return {
    id,
    async availability() {
      const key = await resolveKey()
      return key ? { ok: true } : { ok: false, reason: `missing ${apiKeyEnv}` }
    },
    async search(request, signal) {
      const key = await resolveKey()
      if (!key) throw Object.assign(new Error(`${id} requires ${apiKeyEnv}`), { status: 401 })
      const body = {
        query: request.query,
        type: 'auto',
        contents: { highlights: { highlightsPerUrl: 1 } },
        ...(request.maxResults !== undefined ? { numResults: request.maxResults } : {}),
      }
      let response
      try {
        response = await fetchImpl(apiUrl, {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': USER_AGENT,
          },
          body: JSON.stringify(body),
          signal: attemptSignal(signal, timeoutMs),
        })
      } catch (error) {
        throw labelAbort(error, id, timeoutMs)
      }
      if (!response.ok) await throwHttpResponse(id, response)
      const payload = await response.json()
      const sources = []
      const seen = new Set()
      for (const item of payload.results ?? []) {
        const url = citeableUrl(item?.url)
        if (url === undefined || seen.has(url)) continue
        seen.add(url)
        const highlight = Array.isArray(item.highlights) ? item.highlights.find((h) => typeof h === 'string' && h.trim().length > 0) : undefined
        const title = typeof item.title === 'string' && item.title ? item.title : undefined
        if (highlight === undefined && title === undefined) continue
        sources.push({
          url,
          ...(title ? { title } : {}),
          ...(highlight ? { snippet: highlight } : {}),
          ...(typeof item.publishedDate === 'string' && item.publishedDate ? { publishedAt: item.publishedDate } : {}),
        })
      }
      return capSources(sources, request.maxResults)
    },
  }
}

/** Tavily backend (keyed). */
export function createTavilyBackend(options) {
  const { resolveKey, apiKeyEnv = 'TAVILY_API_KEY', apiUrl = TAVILY_SEARCH_URL, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const id = 'tavily'
  return {
    id,
    async availability() {
      const key = await resolveKey()
      return key ? { ok: true } : { ok: false, reason: `missing ${apiKeyEnv}` }
    },
    async search(request, signal) {
      const key = await resolveKey()
      if (!key) throw Object.assign(new Error(`${id} requires ${apiKeyEnv}`), { status: 401 })
      const body = { query: request.query, max_results: Math.min(request.maxResults ?? 5, 20), search_depth: 'basic' }
      let response
      try {
        response = await fetchImpl(apiUrl, {
          method: 'POST',
          redirect: 'error',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal: attemptSignal(signal, timeoutMs),
        })
      } catch (error) {
        throw labelAbort(error, id, timeoutMs)
      }
      if (!response.ok) await throwHttpResponse(id, response)
      const payload = await response.json()
      const sources = []
      const seen = new Set()
      for (const item of payload.results ?? []) {
        const url = citeableUrl(item?.url)
        if (url === undefined || seen.has(url)) continue
        seen.add(url)
        sources.push({
          url,
          ...(typeof item.title === 'string' && item.title ? { title: item.title } : {}),
          ...(typeof item.content === 'string' && item.content ? { snippet: item.content } : {}),
        })
      }
      return capSources(sources, request.maxResults)
    },
  }
}

/** Strip tags, decode basic entities, collapse whitespace. */
function stripTags(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Resolve a DDG redirect wrapper to its target URL. */
export function extractDdgUrl(href) {
  if (href === undefined) return undefined
  let value = href
  if (value.startsWith('//')) value = `https:${value}`
  try {
    const url = new URL(value, 'https://duckduckgo.com')
    const target = url.searchParams.get('uddg')
    return citeableUrl(target ?? url.toString())
  } catch {
    return undefined
  }
}

/** DuckDuckGo HTML backend (keyless). */
export function createDdgBackend(options) {
  const { apiUrl = DDG_HTML_URL, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const id = 'ddg'
  return {
    id,
    async availability() {
      return { ok: true }
    },
    async search(request, signal) {
      const params = new URLSearchParams({ q: request.query })
      let response
      try {
        response = await fetchImpl(`${apiUrl}?${params}`, {
          redirect: 'follow',
          headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
          signal: attemptSignal(signal, timeoutMs),
        })
      } catch (error) {
        throw labelAbort(error, id, timeoutMs)
      }
      if (!response.ok && response.status !== 202) await throwHttpResponse(id, response)
      const html = await response.text()
      if (response.status === 202 || /anomaly|captcha|unusual traffic|robot check/i.test(html.slice(0, 4000))) {
        throw Object.assign(new Error(`${id} is rate-limited right now (anti-bot challenge)`), { status: 429 })
      }
      const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? []
      const sources = []
      const seen = new Set()
      for (const block of blocks) {
        const href = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/)?.[1]
        const url = extractDdgUrl(href)
        if (url === undefined || seen.has(url)) continue
        seen.add(url)
        const title = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/)?.[1]
        const snippet = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/)?.[1]
        sources.push({
          url,
          ...(title ? { title: stripTags(title) } : {}),
          ...(snippet ? { snippet: stripTags(snippet) } : {}),
        })
      }
      return capSources(sources, request.maxResults)
    },
  }
}

/** SearXNG backend over public or configured instances (keyless). */
export function createSearxngBackend(options) {
  const { instances = SEARXNG_INSTANCES, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const id = 'searxng'
  return {
    id,
    async availability() {
      return { ok: instances.length > 0 }
    },
    async search(request, signal) {
      const params = new URLSearchParams({ q: request.query, format: 'json' })
      let lastError
      for (const instance of instances) {
        let response
        try {
          response = await fetchImpl(`${instance}/search?${params}`, {
            redirect: 'follow',
            headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
            signal: attemptSignal(signal, timeoutMs),
          })
        } catch (error) {
          lastError = labelAbort(error, `${id} (${instance})`, timeoutMs)
          continue
        }
        if (!response.ok) {
          lastError = Object.assign(new Error(`${id} (${instance}) failed (HTTP ${response.status})`), { status: response.status })
          continue
        }
        const payload = await response.json()
        const sources = []
        const seen = new Set()
        for (const item of payload.results ?? []) {
          const url = citeableUrl(item?.url)
          if (url === undefined || seen.has(url)) continue
          seen.add(url)
          sources.push({
            url,
            ...(typeof item.title === 'string' && item.title ? { title: item.title } : {}),
            ...(typeof item.content === 'string' && item.content ? { snippet: item.content } : {}),
          })
        }
        return capSources(sources, request.maxResults)
      }
      throw Object.assign(new Error(`${id}: no instance succeeded${lastError ? ` (last: ${lastError.message})` : ''}`), {
        cause: lastError,
      })
    },
  }
}
