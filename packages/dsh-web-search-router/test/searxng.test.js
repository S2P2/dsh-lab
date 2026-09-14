import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSearxngAdapter } from '../src/adapters/searxng.js'
import { CANONICAL_ORDER, createDefaultAdapters } from '../src/adapters/index.js'
import { AdapterAbortError, AdapterError } from '../src/errors.js'

const SIGNAL = new AbortController().signal

const ADAPTER_SOURCE = readFileSync(new URL('../src/adapters/searxng.js', import.meta.url), 'utf8')

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

/** One SearXNG JSON-format payload: mapping, dedup, scheme filter, answers. */
const FIXTURE_PAYLOAD = {
  query: 'what is dsh',
  results: [
    { url: 'https://example.com/first', title: 'First', content: 'snippet one', publishedDate: '2026-02-03T00:00:00Z' },
    { url: 'https://example.com/first/', content: 'dedup me' }, // trailing-slash duplicate
    { url: 'https://example.com/epoch', title: 'Epoch', content: 'timestamped', publishedDate: 1770000000 }, // epoch seconds
    { url: 'https://example.com/only-url' }, // no snippet/title: survives
    { url: 'javascript:alert(1)', title: 'Bad scheme', content: 'dropped' }, // non-http(s)
    'not-an-object',
  ],
  answers: ['DSH is a harness.'],
}

const BASE = 'https://searx.example.test'
const base = (url = BASE) => async () => url
// Explicit-value thunk (a default parameter would swallow `undefined`).
const at = (url) => async () => url

test('searxng: GETs the one configured base with format=json end-to-end', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createSearxngAdapter({ fetchImpl, getSearxngBaseUrl: base() })
  const result = await adapter.search({ query: 'what is dsh', maxResults: 5 }, SIGNAL)
  assert.equal(fetchImpl.calls.length, 1)
  const { url, init } = fetchImpl.calls[0]
  assert.equal(url, 'https://searx.example.test/search?q=what+is+dsh&format=json')
  assert.equal(init.method, 'GET')
  assert.equal(init.headers.accept, 'application/json')
  assert.equal('authorization' in init.headers, false, 'keyless hop: no auth header')
  assert.deepEqual(result.sources, [
    { url: 'https://example.com/first', title: 'First', snippet: 'snippet one', publishedAt: '2026-02-03T00:00:00Z' },
    { url: 'https://example.com/epoch', title: 'Epoch', snippet: 'timestamped', publishedAt: new Date(1770000000 * 1000).toISOString() },
    { url: 'https://example.com/only-url' },
  ])
  assert.equal(result.truncated, false)
  assert.equal(result.content, 'DSH is a harness.', 'provider answers are preserved as content')
})

test('searxng: base subpath is honored and maxResults truncates', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createSearxngAdapter({ fetchImpl, getSearxngBaseUrl: base('https://searx.example.test/searxng/') })
  const result = await adapter.search({ query: 'q', maxResults: 2 }, SIGNAL)
  assert.equal(fetchImpl.calls[0].url, 'https://searx.example.test/searxng/search?q=q&format=json')
  assert.equal(result.sources.length, 2)
  assert.equal(result.truncated, true)
})

test('searxng: absent URL ⇒ needs-setup status and config failure, zero network attempts', async () => {
  for (const url of ['', undefined, '   ']) {
    const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
    const adapter = createSearxngAdapter({ fetchImpl, getSearxngBaseUrl: at(url) })
    assert.deepEqual(await adapter.status(), { ok: false, reason: 'no base URL configured', state: 'needs-setup' })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.ok(error instanceof AdapterError)
      assert.equal(error.failureClass, 'config')
      assert.equal(error.message, 'searxng: no base URL configured')
      return true
    })
    assert.equal(fetchImpl.calls.length, 0)
  }
})

test('searxng: bare construction (no thunk) stays needs-setup with zero calls', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createSearxngAdapter({ fetchImpl })
  assert.deepEqual(await adapter.status(), { ok: false, reason: 'no base URL configured', state: 'needs-setup' })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => error.failureClass === 'config')
  assert.equal(fetchImpl.calls.length, 0)
})

test('searxng: invalid URLs (non-http(s), query, fragment, credentials) are needs-setup', async () => {
  const invalid = [
    'ftp://searx.example.test', // non-http(s) scheme
    'file:///srv/searxng', // non-http(s) scheme
    'https://searx.example.test/?lang=en', // query rejected
    'https://searx.example.test/#results', // fragment rejected
    'https://searx.example.test/search?format=json', // baked query path rejected
    'https://key:secret@searx.example.test/', // credentials in authority
    'searx.example.test', // not absolute
    'not a url',
  ]
  for (const url of invalid) {
    const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
    const adapter = createSearxngAdapter({ fetchImpl, getSearxngBaseUrl: base(url) })
    assert.deepEqual(
      await adapter.status(),
      { ok: false, reason: 'no base URL configured', state: 'needs-setup' },
      `expected needs-setup for ${url}`,
    )
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => error.failureClass === 'config')
    assert.equal(fetchImpl.calls.length, 0)
  }
})

test('searxng: status is cheap and local — zero network calls even when configured', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapter = createSearxngAdapter({ fetchImpl, getSearxngBaseUrl: base() })
  assert.deepEqual(await adapter.status(), { ok: true, state: 'ready' })
  await adapter.status()
  await adapter.status()
  assert.equal(fetchImpl.calls.length, 0)
})

test('searxng: single-URL policy — no fallback list in the source, fetches only the configured base', async () => {
  // Grep-level: the banned prior-art shape (a list of deployments to try in
  // order) must not exist in the adapter source at all.
  assert.equal(ADAPTER_SOURCE.includes('SEARXNG_INSTANCES'), false)
  assert.match(ADAPTER_SOURCE, /\bcreateSearxngAdapter\b/)
  assert.doesNotMatch(ADAPTER_SOURCE, /\binstances\b/)
  assert.doesNotMatch(ADAPTER_SOURCE, /\bpools?\b/)
  // Behavioral: every fetch goes to the then-current configured base, one
  // request per search, nowhere else — even when the setting changes.
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  let current = 'https://one.example.test'
  const adapter = createSearxngAdapter({ fetchImpl, getSearxngBaseUrl: async () => current })
  await adapter.search({ query: 'a' }, SIGNAL)
  await adapter.search({ query: 'b' }, SIGNAL)
  current = 'https://two.example.test/deep'
  await adapter.search({ query: 'c' }, SIGNAL)
  assert.equal(fetchImpl.calls.length, 3, 'one request per search: no probing, no fallback attempts')
  assert.ok(fetchImpl.calls[0].url.startsWith('https://one.example.test/search?'))
  assert.ok(fetchImpl.calls[1].url.startsWith('https://one.example.test/search?'))
  assert.ok(fetchImpl.calls[2].url.startsWith('https://two.example.test/deep/search?'))
})

test('searxng: 403 maps to auth with the JSON-format hint in the message', async () => {
  const adapter = createSearxngAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({}, { status: 403 })),
    getSearxngBaseUrl: base(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.failureClass, 'auth')
    assert.equal(error.retryable, false)
    assert.match(error.message, /JSON/)
    assert.match(error.message, /format/)
    assert.match(error.message, /403/)
    return true
  })
})

test('searxng: 401 maps to auth without the hint', async () => {
  const adapter = createSearxngAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({}, { status: 401 })),
    getSearxngBaseUrl: base(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'auth')
    assert.equal(error.message, 'searxng: HTTP 401')
    return true
  })
})

test('searxng: 429 maps to rate_limit with structured retryAfterMs from the header', async () => {
  const adapter = createSearxngAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({}, { status: 429, headers: { 'retry-after': '30' } })),
    getSearxngBaseUrl: base(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'rate_limit')
    assert.equal(error.retryAfterMs, 30_000)
    assert.equal(error.retryable, false)
    return true
  })
})

test('searxng: only 502/503/504 are retryable upstream; 500 is upstream but not retryable', async () => {
  for (const [status, retryable] of [[500, false], [502, true], [503, true], [504, true]]) {
    const adapter = createSearxngAdapter({
      fetchImpl: recordingFetch(() => jsonResponse({}, { status })),
      getSearxngBaseUrl: base(),
    })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'upstream')
      assert.equal(error.retryable, retryable)
      return true
    })
  }
})

test('searxng: network TypeError maps to retryable network', async () => {
  const adapter = createSearxngAdapter({
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    },
    getSearxngBaseUrl: base(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.failureClass, 'network')
    assert.equal(error.retryable, true)
    return true
  })
})

test('searxng: invalid JSON body maps to malformed', async () => {
  const adapter = createSearxngAdapter({
    fetchImpl: recordingFetch(() => jsonResponse('<html>forbidden</html>')),
    getSearxngBaseUrl: base(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'malformed')
    return true
  })
})

test('searxng: valid JSON without a results array maps to malformed', async () => {
  const adapter = createSearxngAdapter({
    fetchImpl: recordingFetch(() => jsonResponse({ detail: 'Not Found' })),
    getSearxngBaseUrl: base(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'malformed')
    return true
  })
})

test('searxng: zero usable results maps to empty (even with answers present)', async () => {
  for (const payload of [
    { query: 'q', results: [], answers: ['an answer alone is not a served search'] },
    { query: 'q', results: [{ url: 'ftp://nope', content: 'non-http(s)' }] },
  ]) {
    const adapter = createSearxngAdapter({
      fetchImpl: recordingFetch(() => jsonResponse(payload)),
      getSearxngBaseUrl: base(),
    })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'empty')
      return true
    })
  }
})

test('searxng: aborts pass through unclassified', async () => {
  const adapter = createSearxngAdapter({
    fetchImpl: async () => {
      const error = new Error('This operation was aborted')
      error.name = 'AbortError'
      throw error
    },
    getSearxngBaseUrl: base(),
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterAbortError)
    assert.equal(error.failureClass, undefined)
    return true
  })
})

test('searxng: registered after zai and before duckduckgo, deps through; registry default stays needs-setup', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(FIXTURE_PAYLOAD))
  const adapters = createDefaultAdapters({ fetchImpl, getSearxngBaseUrl: base() })
  const ids = adapters.map((adapter) => adapter.id)
  const index = ids.indexOf('searxng')
  assert.ok(index > 0, 'searxng is in the default registry')
  assert.equal(ids[index - 1], 'zai')
  assert.equal(ids[index + 1], 'duckduckgo')
  // Relative order matches CANONICAL_ORDER exactly.
  assert.deepEqual(
    ids.filter((id) => CANONICAL_ORDER.includes(id)),
    CANONICAL_ORDER.filter((id) => ids.includes(id)),
  )
  const searxng = adapters[index]
  assert.deepEqual(await searxng.status(), { ok: true, state: 'ready' })
  const result = await searxng.search({ query: 'q', maxResults: 2 }, SIGNAL)
  assert.equal(result.sources.length, 2)
  assert.equal(fetchImpl.calls[0].url, 'https://searx.example.test/search?q=q&format=json')
  // Bare registry construction (no settings host wired yet): needs-setup, zero calls.
  const bare = createDefaultAdapters({ fetchImpl }).find((adapter) => adapter.id === 'searxng')
  assert.deepEqual(await bare.status(), { ok: false, reason: 'no base URL configured', state: 'needs-setup' })
  assert.equal(fetchImpl.calls.length, 1, 'the bare registry check made no further network attempts')
})
