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

/** z.ai MCP `web_search_prime` endpoint — the search wire the GLM Coding Plan covers. */
export const ZAI_MCP_URL = 'https://api.z.ai/api/mcp/web_search_prime/mcp'

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

/**
 * Parse the last matching JSON-RPC payload out of an MCP streamable-http
 * response body: SSE `data:` lines when event-stream, the whole body when JSON.
 */
export function parseMcpPayload(text, id) {
  const candidates = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('data:')) {
      try {
        candidates.push(JSON.parse(trimmed.slice(5).trim()))
      } catch {
        /* skip non-JSON keepalive data */
      }
    }
  }
  if (candidates.length === 0 && text.trimStart().startsWith('{')) {
    try {
      candidates.push(JSON.parse(text))
    } catch {
      /* fall through */
    }
  }
  const byId = candidates.find((payload) => payload?.id === id)
  return byId ?? candidates[candidates.length - 1]
}

/**
 * z.ai backend over the MCP `web_search_prime` streamable-http endpoint — the
 * search wire the GLM Coding Plan covers. (The documented REST endpoint
 * `paas/v4/web_search` is the separately billed Tool API; a plan key gets
 * "Insufficient balance" there. Verified live 2026-08-23.) The MCP session is
 * established lazily and reused; a stale session is re-established once.
 */
export function createZaiBackend(options) {
  const {
    resolveKey,
    apiKeyEnv = 'ZAI_API_KEY',
    mcpUrl = ZAI_MCP_URL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options
  const id = 'zai'
  let sessionId
  let nextId = 0

  async function rpc(key, method, params, signal, { notification = false } = {}) {
    const body = {
      jsonrpc: '2.0',
      ...(notification ? {} : { id: (nextId += 1) }),
      method,
      ...(params === undefined ? {} : { params }),
    }
    let response
    try {
      response = await fetchImpl(mcpUrl, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(sessionId === undefined ? {} : { 'mcp-session-id': sessionId }),
        },
        body: JSON.stringify(body),
        signal: attemptSignal(signal, timeoutMs),
      })
    } catch (error) {
      throw labelAbort(error, id, timeoutMs)
    }
    const headerSession = response.headers?.get?.('mcp-session-id')
    if (typeof headerSession === 'string' && headerSession.length > 0) sessionId = headerSession
    if (!response.ok) await throwHttpResponse(id, response)
    if (notification) return undefined
    const payload = parseMcpPayload(await response.text(), body.id)
    if (payload === undefined) {
      // Observed live: a dropped server session answers a REQUEST with 202 and
      // an empty body (202 is the notification-only status). Mark it stale so
      // the caller can re-establish the session and retry once.
      throw Object.assign(new Error(`${id}: MCP response carried no JSON-RPC payload (stale session)`), { staleSession: true })
    }
    if (payload.error) {
      throw Object.assign(new Error(`${id}: ${payload.error.message ?? 'MCP error'}`), { status: undefined })
    }
    return payload.result
  }

  async function ensureSession(key, signal) {
    if (sessionId !== undefined) return
    await rpc(key, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'dsh-web-search-router', version: '0.1.0' },
    }, signal)
    await rpc(key, 'notifications/initialized', undefined, signal, { notification: true })
  }

  async function callTool(key, request, signal) {
    await ensureSession(key, signal)
    return await rpc(key, 'tools/call', {
      name: 'web_search_prime',
      arguments: { search_query: request.query },
    }, signal)
  }

  return {
    id,
    async availability() {
      const key = await resolveKey()
      return key ? { ok: true } : { ok: false, reason: `missing ${apiKeyEnv}` }
    },
    async search(request, signal) {
      const key = await resolveKey()
      if (!key) throw Object.assign(new Error(`${id} requires ${apiKeyEnv}`), { status: 401 })
      let result
      try {
        result = await callTool(key, request, signal)
      } catch (error) {
        // A dropped server session surfaces either as the spec's 404 on the
        // reused session id or as a payload-less response (observed live);
        // re-establish once and retry. Other statuses (401/403 credentials,
        // 429 billing/rate) rotate instead — a new session won't help.
        const hadSession = sessionId !== undefined
        const sessionDropped = error?.staleSession === true || error?.status === 404
        if (hadSession && sessionDropped) {
          sessionId = undefined
          result = await callTool(key, request, signal)
        } else {
          throw error
        }
      }
      if (result?.isError === true) throw new Error(`${id}: web_search_prime returned a tool error`)
      const text = Array.isArray(result?.content)
        ? result.content.find((part) => part?.type === 'text')?.text
        : undefined
      if (typeof text !== 'string') throw new Error(`${id}: web_search_prime returned no text content`)
      // The live server JSON-encodes the result array one extra time (text is
      // a stringified JSON string); parse until a non-string emerges.
      let items = text
      for (let depth = 0; typeof items === 'string' && depth < 3; depth += 1) {
        try {
          items = JSON.parse(items)
        } catch (error) {
          if (depth === 0) throw new Error(`${id}: web_search_prime payload was not valid JSON`, { cause: error })
          break
        }
      }
      if (typeof items === 'string') throw new Error(`${id}: web_search_prime payload was not valid JSON`)
      if (!Array.isArray(items)) items = items?.search_result
      const sources = []
      const seen = new Set()
      for (const item of items ?? []) {
        const url = citeableUrl(item?.link)
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
