import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTavilyAdapter } from '../src/adapters/tavily.js'
import { AdapterError } from '../src/errors.js'

const SIGNAL = new AbortController().signal

/** Response-ish for the keyed JSON wire; a string body simulates invalid JSON. */
const jsonResponse = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] },
  json: async () => {
    if (typeof body === 'string') throw new SyntaxError(`Unexpected token in JSON: ${body}`)
    return body
  },
})

/** Injected fetch that records every call (hermetic: zero sockets). */
function recordingFetch(respond) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return respond({ url: String(url), init }, calls)
  }
  fn.calls = calls
  return fn
}

const FIXTURE_PAYLOAD = {
  answer: 'Tavily synthesized answer',
  results: [
    { url: 'https://example.com/first', title: 'First', content: 'content snippet', published_date: '2026-01-15', score: 0.99 },
    { url: 'https://example.com/first', title: 'Duplicate', content: 'dropped by dedup' }, // exact duplicate
    { url: 'https://example.com/only-url' }, // no content: survives
    { url: 'file:///etc/hosts', title: 'Bad scheme', content: 'dropped' }, // non-http(s)
    null,
  ],
}

const keyed = (key = 'tvly-key-1') => async () => key

test('tavily: posts the keyed search wire end-to-end', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createTavilyAdapter({ fetchImpl, resolveTavilyKey: keyed() })
  const result = await adapter.search({ query: 'what is dsh', maxResults: 2 }, SIGNAL)
  assert.equal(fetchImpl.calls.length, 1)
  const { url, init } = fetchImpl.calls[0]
  assert.equal(url, 'https://api.tavily.com/search')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.authorization, 'Bearer tvly-key-1')
  assert.equal(init.headers['content-type'], 'application/json')
  const body = JSON.parse(init.body)
  assert.deepEqual(body, { query: 'what is dsh', max_results: 2, search_depth: 'basic' })
  assert.equal(result.content, 'Tavily synthesized answer')
  assert.deepEqual(result.sources, [
    {
      url: 'https://example.com/first',
      title: 'First',
      snippet: 'content snippet',
      publishedAt: '2026-01-15',
    },
    { url: 'https://example.com/only-url' },
  ])
  assert.equal(result.truncated, false)
})

test('tavily: max_results defaults to 5 and clamps at the 20-result cap', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createTavilyAdapter({ fetchImpl, resolveTavilyKey: keyed() })
  await adapter.search({ query: 'q' }, SIGNAL)
  await adapter.search({ query: 'q', maxResults: 50 }, SIGNAL)
  assert.equal(JSON.parse(fetchImpl.calls[0].init.body).max_results, 5)
  assert.equal(JSON.parse(fetchImpl.calls[1].init.body).max_results, 20)
})

test('tavily: maxResults truncates the normalized result', async () => {
  const adapter = createTavilyAdapter({
    fetchImpl: recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD)),
    resolveTavilyKey: keyed(),
  })
  const result = await adapter.search({ query: 'q', maxResults: 1 }, SIGNAL)
  assert.deepEqual(
    result.sources.map((s) => s.url),
    ['https://example.com/first'],
  )
  assert.equal(result.truncated, true)
})

test('tavily: a missing answer stays absent from the result', async () => {
  const adapter = createTavilyAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({ results: [{ url: 'https://example.com/only', content: 's' }] })),
    resolveTavilyKey: keyed(),
  })
  const result = await adapter.search({ query: 'q' }, SIGNAL)
  assert.equal('content' in result, false)
})

test('tavily: status is cheap and local — it never resolves the key', async () => {
  let resolutions = 0
  const adapter = createTavilyAdapter({
    fetchImpl: recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD)),
    resolveTavilyKey: async () => {
      resolutions += 1
      return 'k'
    },
  })
  assert.deepEqual(adapter.status(), { ok: true, state: 'ready' })
  assert.equal(resolutions, 0)
})

test('tavily: unconfigured key is a config failure with zero network attempts', async () => {
  for (const key of [undefined, '', '   ']) {
    const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
    const adapter = createTavilyAdapter({ fetchImpl, resolveTavilyKey: async () => key })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.ok(error instanceof AdapterError)
      assert.equal(error.failureClass, 'config')
      assert.equal(error.message, 'tavily: TAVILY_API_KEY not configured')
      return true
    })
    assert.equal(fetchImpl.calls.length, 0)
  }
})

test('tavily: 401 maps to auth', async () => {
  const adapter = createTavilyAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({ detail: 'invalid key' }, { status: 401 })),
    resolveTavilyKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'auth')
    assert.equal(error.retryable, false)
    return true
  })
})

test('tavily: 429 maps to rate_limit with structured retryAfterMs, never retryable', async () => {
  const adapter = createTavilyAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({}, { status: 429, headers: { 'retry-after': '2' } })),
    resolveTavilyKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'rate_limit')
    assert.equal(error.retryAfterMs, 2_000)
    assert.equal(error.retryable, false)
    return true
  })
})

test('tavily: only 502/503/504 are retryable upstream; 500 is upstream but not retryable', async () => {
  for (const [status, retryable] of [[500, false], [502, true], [503, true], [504, true]]) {
    const adapter = createTavilyAdapter({
      fetchImpl: recordingFetch(() => jsonResponse({}, { status })),
      resolveTavilyKey: keyed(),
    })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'upstream')
      assert.equal(error.retryable, retryable)
      return true
    })
  }
})

test('tavily: network TypeError maps to retryable network', async () => {
  const adapter = createTavilyAdapter({
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    },
    resolveTavilyKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.failureClass, 'network')
    assert.equal(error.retryable, true)
    return true
  })
})

test('tavily: invalid JSON body maps to malformed', async () => {
  const adapter = createTavilyAdapter({
    fetchImpl: recordingFetch(() => jsonResponse('<html>maintenance</html>')),
    resolveTavilyKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'malformed')
    return true
  })
})

test('tavily: valid JSON without a results array maps to malformed', async () => {
  const adapter = createTavilyAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({ detail: 'unexpected envelope' })),
    resolveTavilyKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'malformed')
    return true
  })
})

test('tavily: zero usable results maps to empty', async () => {
  for (const payload of [{ results: [] }, { answer: 'orphan answer', results: [{ url: 'ftp://nope' }] }]) {
    const adapter = createTavilyAdapter({
      fetchImpl: recordingFetch(() => jsonResponse(payload)),
      resolveTavilyKey: keyed(),
    })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'empty')
      return true
    })
  }
})

test('tavily: the key resolves per search operation, never cached', async () => {
  let key = 'key-one'
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createTavilyAdapter({ fetchImpl, resolveTavilyKey: async () => key })
  await adapter.search({ query: 'a', maxResults: 1 }, SIGNAL)
  key = 'key-two'
  await adapter.search({ query: 'b', maxResults: 1 }, SIGNAL)
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer key-one')
  assert.equal(fetchImpl.calls[1].init.headers.authorization, 'Bearer key-two')
})

test('tavily: no error message ever carries the key value', async () => {
  const secret = 'tvly-super-secret-value'
  const adapter = createTavilyAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({}, { status: 403 })),
    resolveTavilyKey: async () => secret,
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(!error.message.includes(secret))
    assert.equal(error.trail, undefined)
    return true
  })
})
