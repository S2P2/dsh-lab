import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createExaAdapter } from '../src/adapters/exa.js'
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

/** One mapped exa result. */
const FIXTURE_PAYLOAD = {
  results: [
    { url: 'https://example.com/first', title: 'First', publishedDate: '2026-02-03', highlights: ['highlight one', 'second'] },
    { url: 'https://example.com/first/', highlights: ['dedup me'] }, // trailing-slash duplicate
    { url: 'https://example.com/only-url' }, // no snippet/title: survives
    { url: 'https://example.com/text-only', text: 'fallback text snippet' }, // text when no highlights
    { url: 'javascript:alert(1)', title: 'Bad scheme', highlights: ['dropped'] }, // non-http(s)
    'not-an-object',
  ],
}

const keyed = (key = 'exa-key-1') => async () => key

test('exa: posts the keyed search wire end-to-end', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createExaAdapter({ fetchImpl, resolveExaKey: keyed() })
  const result = await adapter.search({ query: 'what is dsh', maxResults: 3 }, SIGNAL)
  assert.equal(fetchImpl.calls.length, 1)
  const { url, init } = fetchImpl.calls[0]
  assert.equal(url, 'https://api.exa.ai/search')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.authorization, 'Bearer exa-key-1')
  assert.equal(init.headers['content-type'], 'application/json')
  const body = JSON.parse(init.body)
  assert.equal(body.query, 'what is dsh')
  assert.equal(body.type, 'auto')
  assert.deepEqual(body.contents, { highlights: { highlightsPerUrl: 1 } })
  assert.equal(body.numResults, 3)
  assert.deepEqual(result.sources, [
    { url: 'https://example.com/first', title: 'First', snippet: 'highlight one', publishedAt: '2026-02-03' },
    { url: 'https://example.com/only-url' },
    { url: 'https://example.com/text-only', snippet: 'fallback text snippet' },
  ])
  assert.equal(result.truncated, false)
})

test('exa: numResults stays absent without maxResults; maxResults truncates', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createExaAdapter({ fetchImpl, resolveExaKey: keyed() })
  const result = await adapter.search({ query: 'q' }, SIGNAL)
  assert.equal('numResults' in JSON.parse(fetchImpl.calls[0].init.body), false)
  assert.deepEqual(
    result.sources.map((s) => s.url),
    ['https://example.com/first', 'https://example.com/only-url', 'https://example.com/text-only'],
  )
  const capped = await adapter.search({ query: 'q', maxResults: 2 }, SIGNAL)
  assert.equal(capped.sources.length, 2)
  assert.equal(capped.truncated, true)
})

test('exa: status is cheap and local — it never resolves the key', async () => {
  let resolutions = 0
  const adapter = createExaAdapter({
    fetchImpl: recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD)),
    resolveExaKey: async () => {
      resolutions += 1
      return 'k'
    },
  })
  assert.deepEqual(adapter.status(), { ok: true, state: 'ready' })
  assert.equal(resolutions, 0)
})

test('exa: unconfigured key is a config failure with zero network attempts', async () => {
  for (const key of [undefined, '', '   ']) {
    const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
    const adapter = createExaAdapter({ fetchImpl, resolveExaKey: async () => key })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.ok(error instanceof AdapterError)
      assert.equal(error.failureClass, 'config')
      assert.equal(error.message, 'exa: EXA_API_KEY not configured')
      return true
    })
    assert.equal(fetchImpl.calls.length, 0)
  }
})

test('exa: 401 maps to auth', async () => {
  const adapter = createExaAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({ error: 'bad key' }, { status: 401 })),
    resolveExaKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'auth')
    assert.equal(error.retryable, false)
    return true
  })
})

test('exa: 429 maps to rate_limit with structured retryAfterMs, never retryable', async () => {
  const adapter = createExaAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({}, { status: 429, headers: { 'retry-after': '30' } })),
    resolveExaKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'rate_limit')
    assert.equal(error.retryAfterMs, 30_000)
    assert.equal(error.retryable, false)
    return true
  })
})

test('exa: only 502/503/504 are retryable upstream; 500 is upstream but not retryable', async () => {
  for (const [status, retryable] of [[500, false], [502, true], [503, true], [504, true]]) {
    const adapter = createExaAdapter({
      fetchImpl: recordingFetch(() => jsonResponse({}, { status })),
      resolveExaKey: keyed(),
    })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'upstream')
      assert.equal(error.retryable, retryable)
      return true
    })
  }
})

test('exa: network TypeError maps to retryable network', async () => {
  const adapter = createExaAdapter({
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    },
    resolveExaKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.failureClass, 'network')
    assert.equal(error.retryable, true)
    return true
  })
})

test('exa: invalid JSON body maps to malformed', async () => {
  const adapter = createExaAdapter({
    fetchImpl: recordingFetch(() => jsonResponse('<html>gateway echo</html>')),
    resolveExaKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'malformed')
    return true
  })
})

test('exa: valid JSON without a results array maps to malformed', async () => {
  const adapter = createExaAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({ message: 'unexpected envelope' })),
    resolveExaKey: keyed(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'malformed')
    return true
  })
})

test('exa: zero usable results maps to empty', async () => {
  for (const payload of [{ results: [] }, { results: [{ url: 'ftp://nope' }] }]) {
    const adapter = createExaAdapter({
      fetchImpl: recordingFetch(() => jsonResponse(payload)),
      resolveExaKey: keyed(),
    })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'empty')
      return true
    })
  }
})

test('exa: the key resolves per search operation, never cached', async () => {
  let key = 'key-one'
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createExaAdapter({ fetchImpl, resolveExaKey: async () => key })
  await adapter.search({ query: 'a', maxResults: 1 }, SIGNAL)
  key = 'key-two'
  await adapter.search({ query: 'b', maxResults: 1 }, SIGNAL)
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer key-one')
  assert.equal(fetchImpl.calls[1].init.headers.authorization, 'Bearer key-two')
})

test('exa: no error message ever carries the key value', async () => {
  const secret = 'sk-super-secret-exa-value'
  const adapter = createExaAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({}, { status: 401 })),
    resolveExaKey: async () => secret,
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(!error.message.includes(secret))
    assert.equal(error.trail, undefined)
    return true
  })
})
