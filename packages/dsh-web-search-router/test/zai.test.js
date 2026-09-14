import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createZaiAdapter, ZAI_MCP_URL } from '../src/adapters/zai.js'
import { AdapterError, AdapterAbortError } from '../src/errors.js'

const SIGNAL = new AbortController().signal

/** Observed live entry shape: title, link, content, publish_date (url/publishedDate variants seen too). */
const SEARCH_ITEMS = [
  { title: 'First', link: 'https://z.example/1', content: 'snippet one', publish_date: '2026-09-01' },
  { title: 'First again', link: 'https://z.example/1', content: 'duplicate drops in normalization' },
  { link: 'ftp://z.example/ftp', content: 'non-http source is filtered' },
  { title: 'Second', url: 'https://z.example/2', content: 'snippet two', publishedDate: '2026-09-02' },
]

/** SSE-frame one JSON-RPC payload the way the streamable-http server does. */
const sse = (payload) => `event: message\ndata: ${JSON.stringify(payload)}\n\n`

const responseHeaders = (map = {}) => ({ get: (name) => map[name.toLowerCase()] ?? null })

/** A 2xx MCP response; `sseFramed: false` yields the plain-JSON envelope variant. */
function mcpResponse(payload, { status = 200, headers = {}, sseFramed = true } = {}) {
  const body = payload === undefined ? '' : sseFramed ? sse(payload) : JSON.stringify(payload)
  return { ok: status >= 200 && status < 300, status, headers: responseHeaders(headers), text: async () => body }
}

const jsonResponse = (status, body, headers = {}) => ({
  ok: false,
  status,
  headers: responseHeaders(headers),
  text: async () => JSON.stringify(body),
})

/**
 * Stateful fake of the z.ai MCP streamable-http server: full session
 * lifecycle, argument-shape validation, and pluggable tools/call overrides.
 */
function fakeZaiMcp({ toolResult, onToolCall, acceptArguments } = {}) {
  const state = { session: undefined, initializeCalls: 0, calls: [], fetches: 0 }
  const defaultToolResult = () => ({ content: [{ type: 'text', text: JSON.stringify(SEARCH_ITEMS) }] })
  const fetchImpl = async (url, init) => {
    state.fetches += 1
    assert.equal(String(url), ZAI_MCP_URL, 'all MCP traffic goes to the one streamable-http endpoint')
    const body = JSON.parse(init.body)
    state.calls.push({
      method: body.method,
      id: body.id,
      args: body.params?.arguments,
      authorization: init.headers.authorization,
      session: init.headers['mcp-session-id'],
    })
    if (body.method === 'initialize') {
      state.initializeCalls += 1
      state.session = `sess-${state.initializeCalls}`
      return mcpResponse(
        { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'zai' } } },
        { headers: { 'mcp-session-id': state.session } },
      )
    }
    if (body.method === 'notifications/initialized') {
      if (init.headers['mcp-session-id'] !== state.session) return jsonResponse(400, { error: 'bad session' })
      return { ok: true, status: 202, headers: responseHeaders(), text: async () => '' }
    }
    if (body.method === 'tools/call') {
      if (init.headers['mcp-session-id'] !== state.session) return jsonResponse(404, { error: 'session expired' })
      if (onToolCall !== undefined) {
        const overridden = await onToolCall({ body, state, init })
        if (overridden !== undefined) return overridden
      }
      if (acceptArguments !== undefined && !acceptArguments(body.params?.arguments)) {
        return mcpResponse({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params: expected search_query' } })
      }
      return mcpResponse({ jsonrpc: '2.0', id: body.id, result: toolResult === undefined ? defaultToolResult() : toolResult() })
    }
    return jsonResponse(400, { error: `unexpected ${body.method}` })
  }
  return { fetchImpl, state }
}

const adapter = (mcp, resolveZaiKey = async () => 'zai-key') =>
  createZaiAdapter({ fetchImpl: mcp.fetchImpl, resolveZaiKey })

test('zai: status is cheap, local, and always ready (key handling is per-operation)', async () => {
  const mcp = fakeZaiMcp()
  assert.deepEqual(adapter(mcp).status(), { ok: true, state: 'ready' })
  assert.equal(mcp.state.fetches, 0)
})

test('zai: full MCP search end-to-end — initialize → initialized → tools/call, Bearer everywhere, session propagated', async () => {
  const mcp = fakeZaiMcp()
  const result = await adapter(mcp).search({ query: 'what is dsh', maxResults: 1 }, SIGNAL)
  assert.deepEqual(
    mcp.state.calls.map((call) => call.method),
    ['initialize', 'notifications/initialized', 'tools/call'],
  )
  for (const call of mcp.state.calls) {
    assert.equal(call.authorization, 'Bearer zai-key', 'Bearer auth on every call, the initialize handshake included')
  }
  assert.ok(!('id' in mcp.state.calls[1] && mcp.state.calls[1].id !== undefined), 'notifications/initialized is a notification')
  assert.equal(mcp.state.calls[1].session, 'sess-1', 'session id propagates onto the initialized notification')
  assert.equal(mcp.state.calls[2].session, 'sess-1', 'session id propagates onto the tool call')
  assert.deepEqual(mcp.state.calls[2].args, { query: 'what is dsh' }, 'first argument shape is tried first')
  assert.deepEqual(result.sources, [
    { url: 'https://z.example/1', title: 'First', snippet: 'snippet one', publishedAt: '2026-09-01' },
  ])
  assert.equal(result.truncated, true, 'dedup + http(s) filter leave 2, maxResults caps at 1')
  assert.equal(result.content, undefined, 'no answer text in this fixture')
})

test('zai: session is cached per adapter instance and the key resolves per operation (rotated key reaches the wire)', async () => {
  let key = 'key-one'
  const mcp = fakeZaiMcp()
  const zai = createZaiAdapter({ fetchImpl: mcp.fetchImpl, resolveZaiKey: async () => key })
  await zai.search({ query: 'one' }, SIGNAL)
  key = 'key-two'
  await zai.search({ query: 'two' }, SIGNAL)
  assert.equal(mcp.state.initializeCalls, 1, 'the MCP session is reused across searches')
  assert.deepEqual(
    mcp.state.calls.map((call) => call.method),
    ['initialize', 'notifications/initialized', 'tools/call', 'tools/call'],
  )
  assert.equal(mcp.state.calls[3].authorization, 'Bearer key-two', 'the rotated key reaches the next search')
})

test('zai: plain-JSON envelope responses serve like SSE-framed ones', async () => {
  const mcp = fakeZaiMcp({
    onToolCall: ({ body }) => mcpResponse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(SEARCH_ITEMS) }] } }, { sseFramed: false }),
  })
  const result = await adapter(mcp).search({ query: 'q' }, SIGNAL)
  assert.deepEqual(
    result.sources.map((source) => source.url),
    ['https://z.example/1', 'https://z.example/2'],
  )
})

test('zai: result payloads are found in every documented location variant', async () => {
  const variants = {
    'direct array': () => SEARCH_ITEMS,
    'search_result object': () => ({ search_result: SEARCH_ITEMS }),
    'results object': () => ({ results: SEARCH_ITEMS }),
    'structuredContent nesting': () => ({ structuredContent: { search_result: SEARCH_ITEMS } }),
    'JSON-encoded text content': () => ({ content: [{ type: 'text', text: JSON.stringify(SEARCH_ITEMS) }] }),
    'double-stringified text content': () => ({ content: [{ type: 'text', text: JSON.stringify(JSON.stringify(SEARCH_ITEMS)) }] }),
  }
  for (const [name, toolResult] of Object.entries(variants)) {
    const mcp = fakeZaiMcp({ toolResult })
    const result = await adapter(mcp).search({ query: 'q' }, SIGNAL)
    assert.deepEqual(
      result.sources.map((source) => source.url),
      ['https://z.example/1', 'https://z.example/2'],
      name,
    )
  }
})

test('zai: non-JSON text content next to an items payload is preserved as provider content', async () => {
  const mcp = fakeZaiMcp({
    toolResult: () => ({
      content: [
        { type: 'text', text: JSON.stringify({ search_result: SEARCH_ITEMS }) },
        { type: 'text', text: 'Answer: DSH is a harness extension lab.' },
      ],
    }),
  })
  const result = await adapter(mcp).search({ query: 'q' }, SIGNAL)
  assert.equal(result.content, 'Answer: DSH is a harness extension lab.')
  assert.equal(result.sources.length, 2)
})

test('zai: argument shapes fall back query → search_query → search_query+search_engine on rejection', async () => {
  const mcp = fakeZaiMcp({ acceptArguments: (args) => args?.search_engine === 'search-prime' })
  const result = await adapter(mcp).search({ query: 'drifted server' }, SIGNAL)
  const toolCalls = mcp.state.calls.filter((call) => call.method === 'tools/call')
  assert.deepEqual(toolCalls.map((call) => call.args), [
    { query: 'drifted server' },
    { search_query: 'drifted server' },
    { search_query: 'drifted server', search_engine: 'search-prime' },
  ])
  assert.equal(mcp.state.initializeCalls, 1, 'argument fallback reuses the session')
  assert.equal(result.sources.length, 2)
})

test('zai: non-argument JSON-RPC errors do not burn the argument fallback (quota example)', async () => {
  const mcp = fakeZaiMcp({
    onToolCall: ({ body }) => mcpResponse({ jsonrpc: '2.0', id: body.id, error: { code: 402, message: 'Insufficient balance' } }),
  })
  await assert.rejects(adapter(mcp).search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.failureClass, 'quota')
    return true
  })
  assert.equal(mcp.state.calls.filter((call) => call.method === 'tools/call').length, 1)
})

test('zai: JSON-RPC error codes classify 429 / 5xx / auth-ish', async () => {
  for (const [code, failureClass, retryable] of [[429, 'rate_limit', undefined], [500, 'upstream', true], [503, 'upstream', true], [401, 'auth', undefined]]) {
    const mcp = fakeZaiMcp({
      onToolCall: ({ body }) => mcpResponse({ jsonrpc: '2.0', id: body.id, error: { code, message: `err ${code}` } }),
    })
    await assert.rejects(adapter(mcp).search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, failureClass, `code ${code}`)
      assert.equal(error.retryable, retryable === true, `code ${code} retryable`)
      return true
    })
  }
})

test('zai: tool-level isError maps to upstream (empty content to malformed)', async () => {
  const failing = fakeZaiMcp({ toolResult: () => ({ isError: true, content: [{ type: 'text', text: 'search backend failed' }] }) })
  await assert.rejects(adapter(failing).search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'upstream')
    return true
  })
  const contentless = fakeZaiMcp({ toolResult: () => ({ isError: true }) })
  await assert.rejects(adapter(contentless).search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'malformed')
    return true
  })
})

test('zai: a payload-less 202 (dropped session, observed live) re-initializes once and retries', async () => {
  let dropOnce = true
  const mcp = fakeZaiMcp({
    onToolCall: () => {
      if (!dropOnce) return undefined
      dropOnce = false
      return { ok: true, status: 202, headers: responseHeaders(), text: async () => '' }
    },
  })
  const result = await adapter(mcp).search({ query: 'q' }, SIGNAL)
  assert.equal(mcp.state.initializeCalls, 2)
  assert.deepEqual(
    mcp.state.calls.map((call) => call.method),
    ['initialize', 'notifications/initialized', 'tools/call', 'initialize', 'notifications/initialized', 'tools/call'],
  )
  assert.equal(mcp.state.calls.at(-1).session, 'sess-2', 'the retried tool call rides the fresh session')
  assert.equal(result.sources.length, 2)
})

test('zai: repair is bounded — a second stale answer fails the attempt instead of looping', async () => {
  const mcp = fakeZaiMcp({
    onToolCall: () => ({ ok: true, status: 202, headers: responseHeaders(), text: async () => '' }),
  })
  await assert.rejects(adapter(mcp).search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.failureClass, 'upstream')
    return true
  })
  assert.equal(mcp.state.initializeCalls, 2, 'exactly one repair')
  assert.equal(mcp.state.calls.length, 6, 'init, initialized, call, then once more — no third round')
})

test('zai: a server-rotated session (HTTP 404) re-initializes once and retries', async () => {
  const mcp = fakeZaiMcp()
  let expireOnce = true
  const wrapped = {
    state: mcp.state,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body)
      if (body.method === 'tools/call' && expireOnce) {
        expireOnce = false
        mcp.state.session = 'rotated-by-server'
        return jsonResponse(404, { error: 'session expired' })
      }
      return mcp.fetchImpl(url, init)
    },
  }
  const result = await adapter(wrapped).search({ query: 'q' }, SIGNAL)
  assert.equal(mcp.state.initializeCalls, 2, 're-initialized after the 404')
  assert.equal(result.sources.length, 2)
})

test('zai: an explicit JSON-RPC session error re-initializes once and retries', async () => {
  let once = true
  const mcp = fakeZaiMcp({
    onToolCall: ({ body }) => {
      if (!once) return undefined
      once = false
      return mcpResponse({ jsonrpc: '2.0', id: body.id, error: { code: -32001, message: 'Session expired, please re-initialize' } })
    },
  })
  const result = await adapter(mcp).search({ query: 'q' }, SIGNAL)
  assert.equal(mcp.state.initializeCalls, 2)
  assert.equal(result.sources.length, 2)
})

test('zai: HTTP 429 on tools/call is rate_limit with Retry-After, without re-initializing', async () => {
  const mcp = fakeZaiMcp({
    onToolCall: () => jsonResponse(429, { message: 'rate limited' }, { 'retry-after': '30' }),
  })
  await assert.rejects(adapter(mcp).search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'rate_limit')
    assert.equal(error.retryAfterMs, 30_000)
    return true
  })
  assert.equal(mcp.state.initializeCalls, 1, 'a rate limit is not a dropped session')
})

test('zai: HTTP auth failures on the handshake classify as auth', async () => {
  const mcp = fakeZaiMcp()
  const zai = createZaiAdapter({
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body)
      if (body.method === 'initialize') return jsonResponse(401, { message: 'bad key' })
      return mcp.fetchImpl(url, init)
    },
    resolveZaiKey: async () => 'wrong-key',
  })
  await assert.rejects(zai.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'auth')
    return true
  })
})

test('zai: shapeless tool results are malformed; unparseable handshake responses are malformed', async () => {
  const shapeless = fakeZaiMcp({ toolResult: () => ({ weird: 'shape' }) })
  await assert.rejects(adapter(shapeless).search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'malformed')
    return true
  })
  const mcp = fakeZaiMcp()
  const garbage = createZaiAdapter({
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body)
      if (body.method === 'initialize') {
        return { ok: true, status: 200, headers: responseHeaders(), text: async () => '<html>maintenance</html>' }
      }
      return mcp.fetchImpl(url, init)
    },
    resolveZaiKey: async () => 'zai-key',
  })
  await assert.rejects(garbage.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'malformed')
    return true
  })
})

test('zai: zero usable sources are the empty failure (well-formed but empty, or all non-http)', async () => {
  for (const toolResult of [() => ({ search_result: [] }), () => ({ search_result: [{ link: 'ftp://nope.example/1' }] })]) {
    const mcp = fakeZaiMcp({ toolResult })
    await assert.rejects(adapter(mcp).search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'empty')
      return true
    })
  }
})

test('zai: an unconfigured key fails as config with zero network attempts', async () => {
  for (const resolveZaiKey of [async () => undefined, async () => '']) {
    const mcp = fakeZaiMcp()
    await assert.rejects(adapter(mcp, resolveZaiKey).search({ query: 'q' }, SIGNAL), (error) => {
      assert.ok(error instanceof AdapterError)
      assert.equal(error.failureClass, 'config')
      assert.match(error.message, /ZAI_API_KEY/)
      assert.equal(mcp.state.fetches, 0, 'no fetch is attempted without a key')
      return true
    })
  }
})

test('zai: the default resolver reads the credential seam and tolerates its absence', async () => {
  const mcp = fakeZaiMcp()
  const viaSeam = createZaiAdapter({
    fetchImpl: mcp.fetchImpl,
    credentials: { resolve: async (ref) => (ref === 'ZAI_API_KEY' ? 'seam-key' : undefined) },
  })
  const result = await viaSeam.search({ query: 'q' }, SIGNAL)
  assert.equal(result.sources.length, 2)
  assert.equal(mcp.state.calls[0].authorization, 'Bearer seam-key')

  const seamless = createZaiAdapter({ fetchImpl: mcp.fetchImpl })
  await assert.rejects(seamless.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'config')
    return true
  })
})

test('zai: a throwing resolver is a config failure, never a network attempt', async () => {
  const mcp = fakeZaiMcp()
  await assert.rejects(adapter(mcp, async () => { throw new Error('seam down') }).search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'config')
    assert.equal(mcp.state.fetches, 0)
    return true
  })
})

test('zai: an abort mid-session passes through unclassified with no repair', async () => {
  const mcp = fakeZaiMcp()
  let aborted = false
  const zai = createZaiAdapter({
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body)
      if (body.method === 'notifications/initialized') {
        aborted = true
        throw new DOMException('This operation was aborted', 'AbortError')
      }
      return mcp.fetchImpl(url, init)
    },
    resolveZaiKey: async () => 'zai-key',
  })
  await assert.rejects(zai.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterAbortError, 'the walk classifies aborts, not the adapter')
    assert.ok(!(error instanceof AdapterError))
    return true
  })
  assert.ok(aborted)
  assert.deepEqual(
    mcp.state.calls.map((call) => call.method),
    ['initialize'],
    'no repair, no further calls after the abort',
  )
})
