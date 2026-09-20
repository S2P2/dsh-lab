/**
 * z.ai adapter — MCP Streamable-HTTP hop over the `web_search_prime` tool.
 *
 * Speaks the MCP-compatible flow (initialize → notifications/initialized →
 * tools/call) against `https://api.z.ai/api/mcp/web_search_prime/mcp` with
 * Bearer auth on EVERY call (the handshake included — the initialize request
 * must carry it) and `Mcp-Session-Id` propagation. The session is cached per
 * adapter instance and reused across searches; a stale session (a request
 * answered 202 with an empty body — observed live —, HTTP 404 on a session'd
 * call, or an explicit session error) is re-established ONCE and the tool
 * call retried within the same search() invocation: bounded, adapter-internal
 * repair that never counts as the router's transient retry.
 *
 * Wire shapes adapted from PR #9's live-tested zai backend and
 * can1357/oh-my-pi's zai provider: SSE `data:`-framed or plain-JSON
 * envelopes; JSON-RPC errors and tool-level `isError`; argument shapes that
 * drifted across server versions (`query` → `search_query` → `search_query` +
 * `search_engine`); result payloads sitting directly, under `search_result` /
 * `results`, or JSON-encoded inside MCP text content — sometimes
 * stringified twice.
 *
 * The adapter never creates timers (the router walk owns deadlines), never
 * caches the credential (resolved per search operation), and never lets the
 * key value into an error message or result.
 * @module
 */
import { AdapterError } from '../errors.js'
import { parseRetryAfterMs, statusFailureClass, translateFetchError } from '../http.js'
import { normalizeResult } from '../normalize.js'

/** z.ai MCP `web_search_prime` streamable-http endpoint — the search wire the GLM Coding Plan covers. */
export const ZAI_MCP_URL = 'https://api.z.ai/api/mcp/web_search_prime/mcp'
/** Fixed DSH credential reference for the z.ai API key (spec #8). */
export const ZAI_CREDENTIAL_REF = 'ZAI_API_KEY'

const TOOL_NAME = 'web_search_prime'
const PROTOCOL_VERSION = '2025-03-26'
const CLIENT_INFO = { name: 'dsh-web-search-router', version: '0.1.0' }

/** Tool argument shapes tried in order — server versions drifted across these (oh-my-pi prior art). */
const ARGUMENT_SHAPES = [
  (query) => ({ query }),
  (query) => ({ search_query: query }),
  (query) => ({ search_query: query, search_engine: 'search-prime' }),
]

/** First non-empty string among the values, else undefined. */
function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** True when an error code/text suggests the server rejected the argument SHAPE (not the query itself). */
function isArgumentRejection(code, message) {
  if (code === -32602 || code === -32600 || code === 400) return true
  return /\b(invalid|arguments?|params?|search_query|unexpected|missing|required)\b/i.test(message ?? '')
}

/** True when an error text says the server dropped the MCP session. */
function isSessionError(message) {
  const text = message ?? ''
  return /session/i.test(text) && /expir|stale|invalid|not ?found|unknown|closed/i.test(text)
}

/** Internal marker for a dropped/stale MCP session: repairable once inside the same search(). */
function staleSessionFailure(message) {
  const error = new AdapterError(message, 'upstream')
  error.staleSession = true
  return error
}

/**
 * Classify a JSON-RPC-level failure (envelope error, direct z.ai error
 * object, or tool-level `isError` text) into the closed vocabulary. The
 * numeric code is treated HTTP-ish when it looks like an HTTP status;
 * 5xx-equivalents stay eligible for the router's transient retry.
 */
function jsonRpcFailure(message, code) {
  const text = String(message ?? 'MCP error')
  let failureClass = 'upstream'
  const options = {}
  if (code === 401 || code === 403 || /unauthorized|forbidden|\bapi ?key\b|\btoken\b/i.test(text)) {
    failureClass = 'auth'
  } else if (code === 429 || /\brate ?limit|too many requests\b/i.test(text)) {
    failureClass = 'rate_limit'
  } else if (/insufficient balance|\bquota\b/i.test(text)) {
    failureClass = 'quota'
  } else if (typeof code === 'number' && code >= 500) {
    options.retryable = true
  }
  const suffix = typeof code === 'number' ? ` (${code})` : ''
  return new AdapterError(`zai: ${text.slice(0, 200)}${suffix}`, failureClass, options)
}

/**
 * Parse the JSON-RPC payload out of an MCP streamable-http response body:
 * SSE `data:` lines when event-stream, the whole body when plain JSON.
 * Prefers the candidate matching the request id, else the last candidate.
 * (Adapted from PR #9's live-tested backends.js.)
 * @param {string} text @param {number} id request id
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
  return candidates.find((payload) => payload?.id === id) ?? candidates[candidates.length - 1]
}

/** Classify a tool-level `isError` result: session errors repair, argument rejections fall back, the rest is upstream. */
function toolLevelError(result) {
  const text = (Array.isArray(result.content) ? result.content : [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim()
  if (text.length === 0) {
    return new AdapterError('zai: web_search_prime returned a tool error without content', 'malformed')
  }
  if (isSessionError(text)) return staleSessionFailure(`zai: ${text.slice(0, 200)}`)
  const code = text.match(/MCP error\s*-?(\d+)/i)?.[1]
  const error = jsonRpcFailure(text, code === undefined ? undefined : Number(code))
  if (isArgumentRejection(code === undefined ? undefined : Number(code), text)) error.argumentRejected = true
  return error
}

/**
 * Interpret one JSON-RPC response payload: direct z.ai error envelopes,
 * `payload.error`, tool-level `isError`, or the tool result. Throws the
 * classified AdapterError; returns `payload.result` when present, else the
 * payload itself (some server versions skip the envelope).
 */
function interpretMcpPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload
  if (payload.success === false) {
    const message = payload.msg ?? payload.message ?? payload.error_message
    if (isSessionError(message)) throw staleSessionFailure(`zai: ${String(message).slice(0, 200)}`)
    const error = jsonRpcFailure(message, typeof payload.code === 'number' ? payload.code : undefined)
    if (isArgumentRejection(payload.code, message)) error.argumentRejected = true
    throw error
  }
  if (payload.error !== undefined && payload.error !== null) {
    const { code, message } = payload.error
    if (isSessionError(message)) throw staleSessionFailure(`zai: ${String(message ?? 'session error').slice(0, 200)}`)
    const error = jsonRpcFailure(message, typeof code === 'number' ? code : undefined)
    if (isArgumentRejection(code, message)) error.argumentRejected = true
    throw error
  }
  if (payload.result !== null && typeof payload.result === 'object' && payload.result.isError === true) {
    throw toolLevelError(payload.result)
  }
  return payload.result !== undefined ? payload.result : payload
}

/** Items array from a candidate payload position: direct / `search_result` / `results`. */
function collectItems(candidate) {
  if (Array.isArray(candidate)) return candidate
  if (candidate !== null && typeof candidate === 'object') {
    if (Array.isArray(candidate.search_result)) return candidate.search_result
    if (Array.isArray(candidate.results)) return candidate.results
  }
  return undefined
}

/**
 * Extract the search items (plus any provider answer text) from a
 * web_search_prime tool result: the payload may sit directly, under
 * `structuredContent`/`data`/`result`, or JSON-encoded inside MCP text
 * content — sometimes stringified twice. Returns undefined when nothing in
 * the result has a recognizable shape (malformed).
 */
export function extractZaiPayload(result) {
  const candidates = []
  const texts = []
  if (Array.isArray(result) || (result !== null && typeof result === 'object')) candidates.push(result)
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    for (const key of ['structuredContent', 'data', 'result']) {
      if (result[key] !== undefined) candidates.push(result[key])
    }
    for (const part of Array.isArray(result.content) ? result.content : []) {
      const text = typeof part?.text === 'string' ? part.text : ''
      if (text.trim().length === 0) continue
      let parsed
      let decoded = false
      try {
        parsed = JSON.parse(text)
        decoded = true
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed)
          } catch {
            /* the decoded string is answer text, not another JSON payload */
          }
        }
      } catch {
        /* non-JSON content is preserved as answer text */
      }
      if (decoded) candidates.push(parsed)
      const items = decoded ? collectItems(parsed) : undefined
      if (!decoded || items === undefined || items.length === 0) texts.push(text)
    }
  }
  for (const candidate of candidates) {
    const items = collectItems(candidate)
    if (items !== undefined) {
      return { items, ...(texts.length > 0 ? { content: texts.join('\n\n') } : {}) }
    }
  }
  if (texts.length > 0) return { items: [], content: texts.join('\n\n') }
  return undefined
}

/** Map z.ai result entries (`link`/`url`, title, content, publication date) onto raw sources for normalizeResult. */
export function mapZaiItems(items) {
  const sources = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const url = firstString(item.link, item.url)
    if (url === undefined) continue
    const snippet = firstString(item.content, item.snippet)
    const publishedAt = firstString(item.publish_date, item.publishedDate, item.published_at, item.publishedAt)
    sources.push({
      url,
      ...(firstString(item.title) !== undefined ? { title: item.title } : {}),
      ...(snippet !== undefined ? { snippet } : {}),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    })
  }
  return sources
}

/**
 * Create the z.ai MCP adapter.
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl] injected for hermetic tests
 * @param {() => Promise<string | undefined>} [deps.resolveZaiKey] credential resolver, called per search
 *   operation (never cached); defaults to the DSH credential seam reference `ZAI_API_KEY`, tolerating an
 *   absent seam (returns undefined then)
 */
export function createZaiAdapter(deps = {}) {
  const {
    fetchImpl = fetch,
    resolveZaiKey = async () => deps.credentials?.resolve(ZAI_CREDENTIAL_REF),
  } = deps
  const id = 'zai'
  let sessionId
  let nextId = 0

  async function resolveKey() {
    let key
    try {
      key = await resolveZaiKey()
    } catch (error) {
      throw new AdapterError(`${id}: ${ZAI_CREDENTIAL_REF} resolution failed`, 'config', { cause: error })
    }
    return typeof key === 'string' && key.length > 0 ? key : undefined
  }

  /** HTTP-level failure: 404 on a session'd call is the spec's dropped-session signal; otherwise classify by status. */
  function httpFailure(response, sentSession) {
    if (response.status === 404 && sentSession) {
      return staleSessionFailure(`${id}: MCP session expired (HTTP 404)`)
    }
    const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'))
    return new AdapterError(
      `${id}: HTTP ${response.status}`,
      statusFailureClass(response.status),
      retryAfterMs !== undefined ? { retryAfterMs } : {},
    )
  }

  /** POST one JSON-RPC message; captures the session header and parses the response payload. */
  async function rpc(method, params, key, signal, { notification = false } = {}) {
    const body = {
      jsonrpc: '2.0',
      ...(notification ? {} : { id: (nextId += 1) }),
      method,
      ...(params === undefined ? {} : { params }),
    }
    const sentSession = sessionId
    let response
    try {
      response = await fetchImpl(ZAI_MCP_URL, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(sentSession === undefined ? {} : { 'mcp-session-id': sentSession }),
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      throw translateFetchError(error, id)
    }
    const headerSession = response.headers?.get?.('mcp-session-id')
    if (typeof headerSession === 'string' && headerSession.length > 0) sessionId = headerSession
    if (!response.ok) throw httpFailure(response, sentSession !== undefined)
    if (notification) return undefined
    let text
    try {
      text = await response.text()
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw translateFetchError(error, id)
      }
      throw new AdapterError(`${id}: MCP response body unreadable`, 'malformed', { cause: error })
    }
    const payload = parseMcpPayload(text, body.id)
    if (payload === undefined) {
      // Observed live: a dropped server session answers a REQUEST with 202
      // and an empty body (202 is the notification-only status). With a
      // session in play that is the stale-session signal; without one the
      // response is merely unparseable.
      if (sessionId === undefined) throw new AdapterError(`${id}: MCP response was not parseable JSON-RPC`, 'malformed')
      throw staleSessionFailure(`${id}: MCP response carried no JSON-RPC payload (stale session)`)
    }
    return payload
  }

  /** Establish the MCP session once per adapter instance (initialize + initialized notification). */
  async function ensureSession(key, signal) {
    if (sessionId !== undefined) return
    interpretMcpPayload(
      await rpc('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      }, key, signal),
    )
    await rpc('notifications/initialized', undefined, key, signal, { notification: true })
  }

  /** Call the search tool, falling back through the argument shapes when the server rejects one. */
  async function callTool(key, request, signal) {
    for (let shape = 0; shape < ARGUMENT_SHAPES.length; shape += 1) {
      try {
        const payload = await rpc('tools/call', {
          name: TOOL_NAME,
          arguments: ARGUMENT_SHAPES[shape](request.query),
        }, key, signal)
        return interpretMcpPayload(payload)
      } catch (error) {
        if (shape === ARGUMENT_SHAPES.length - 1 || error?.argumentRejected !== true) throw error
        // The server rejected the argument shape (versions drifted across
        // these); retry the same tool call with the next shape — bounded by
        // the list, same session, not a router retry.
      }
    }
    throw new AdapterError(`${id}: web_search_prime call exhausted argument shapes`, 'upstream')
  }

  return {
    id,
    /** Cheap local status: the key is resolved per search operation, so this stays ready without probes. */
    status() {
      return { ok: true, state: 'ready' }
    },
    /** @param {{query: string, maxResults?: number}} request @param {AbortSignal} attemptSignal */
    async search(request, attemptSignal) {
      const key = await resolveKey()
      if (key === undefined) throw new AdapterError(`${id}: ${ZAI_CREDENTIAL_REF} not configured`, 'config')
      const runToolCall = async () => {
        await ensureSession(key, attemptSignal)
        return await callTool(key, request, attemptSignal)
      }
      let result
      try {
        result = await runToolCall()
      } catch (error) {
        // Bounded, adapter-internal repair: a dropped server session is
        // re-established ONCE and the tool call retried within this same
        // search() — it never counts as the router's transient retry, and a
        // second stale answer fails the attempt instead of looping.
        if (error?.staleSession === true && sessionId !== undefined) {
          sessionId = undefined
          result = await runToolCall()
        } else {
          throw error
        }
      }
      const extracted = extractZaiPayload(result)
      if (extracted === undefined) {
        throw new AdapterError(`${id}: web_search_prime payload had no recognizable shape`, 'malformed')
      }
      const raw = { ...(extracted.content !== undefined ? { content: extracted.content } : {}), sources: mapZaiItems(extracted.items) }
      return normalizeResult(raw, request.maxResults)
    },
  }
}
