import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCodexAdapter } from '../src/adapters/codex.js'
import { AdapterError, AdapterAbortError, ChainExhaustedError } from '../src/errors.js'
import { SearchRouter } from '../src/router.js'

/**
 * Hermetic Codex-hop tests: the real `dsh-codex-connect` is NEVER imported.
 * Every test injects a fake module object (or a rejecting importer); the
 * OAuth document is never touched — the fake store hands back a fixture.
 */

const SIGNAL = new AbortController().signal

/** Credential-like fixture (obviously fake; never printed anywhere). */
const FAKE_CREDENTIAL = {
  providerId: 'openai-codex',
  accountId: 'fake-account-id',
  accessToken: 'fake-access-token-not-a-real-secret',
}

/** Stock WebSearchResult shape the wrapped provider's own mapper returns. */
const STOCK_RESULT = {
  content: 'provider-generated summary',
  sources: [
    { url: 'https://example.com/codex-first', title: 'Codex first', snippet: 'served by codex' },
    { url: 'https://example.com/codex-second', title: 'Codex second' },
    { url: 'https://example.com/codex-third' },
    { url: 'https://example.com/codex-first/', snippet: 'trailing-slash duplicate' },
    { url: 'javascript:alert(1)', title: 'non-http(s) dropped' },
  ],
  truncated: false,
}

/** WebError-like error: the wrapped provider throws these with open-string codes. */
const webError = (code, message) => Object.assign(new Error(message), { code })

/** Plain-object WebError stand-in (translation must not rely on class identity). */
const webErrorPlain = (code, message) => ({ code, message })

/**
 * Fake the wrapped library's export surface (subset the adapter consumes).
 * `overrides.search(provider, request, signal)` replaces the default serve.
 */
function fakeCodexConnect(overrides = {}) {
  const constructed = { stores: [], providers: [] }
  class FakeCredentialStore {
    constructor(filename) {
      this.filename = filename
      constructed.stores.push(this)
    }

    async read() {
      return overrides.credential === undefined ? FAKE_CREDENTIAL : overrides.credential
    }
  }
  class FakeSearchProvider {
    id = 'openai-codex'

    constructor(options) {
      this.options = options
      constructed.providers.push(this)
    }

    async search(request, signal) {
      return overrides.search ? overrides.search(this, request, signal) : STOCK_RESULT
    }
  }
  const mod = {
    OpenAICodexCredentialStore: FakeCredentialStore,
    OpenAICodexSearchProvider: FakeSearchProvider,
  }
  if (overrides.assessCompatibility !== undefined) mod.assessCompatibility = overrides.assessCompatibility
  return { mod, constructed }
}

/** Adapter + fake module wired the production way (module object injected). */
const harness = (overrides = {}, deps = {}) => {
  const fake = fakeCodexConnect(overrides)
  const adapter = createCodexAdapter({ codexConnect: fake.mod, ...deps })
  return { adapter, fake }
}

/** Host-logger capture for the warn-not-disable compatibility gate. */
const capturingLogger = () => {
  const entries = { warn: [], debug: [] }
  return {
    warn: (format, ...args) => entries.warn.push({ format, args }),
    debug: (format, ...args) => entries.debug.push({ format, args }),
    entries,
  }
}

/** Minimal downstream adapter for walk-level fall-through assertions. */
const downstreamAdapter = (id, behavior = 'serve') => ({
  id,
  status: () => ({ ok: true }),
  async search() {
    if (behavior === 'empty') throw new AdapterError(`${id}: nothing`, 'empty')
    return { sources: [{ url: `https://served.by/${id}` }], truncated: false }
  },
})

/** Realistic assessCompatibility input (the d.ts CompatibilityEvaluationInput shape). */
const COMPAT_VERSIONS = {
  nodeVersion: process.version,
  packages: {
    '@deepseek-ai/dsh-llm': '0.1.5-rc.2',
    '@deepseek-ai/dsh-llm-pi-ai': '0.1.5-rc.2',
    '@earendil-works/pi-ai': '0.85.1',
  },
}

test('codex: keyed credential present serves end-to-end through the wrapped provider', async () => {
  const calls = []
  const { adapter, fake } = harness({
    search: (provider, request, signal) => {
      calls.push({ request, signal, provider })
      return STOCK_RESULT
    },
  })
  const result = await adapter.search({ query: 'what is dsh', maxResults: 5 }, SIGNAL)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].request, { query: 'what is dsh', maxResults: 5 })
  assert.equal(calls[0].signal, SIGNAL, 'the walk attempt signal passes straight through')
  assert.equal(calls[0].provider, fake.constructed.providers[0])
  // the store was constructed through the fake module's own class and handed to the provider
  assert.ok(fake.constructed.stores[0] instanceof fake.mod.OpenAICodexCredentialStore)
  assert.equal(fake.constructed.stores[0].filename, undefined, 'default $DSH_HOME path: no explicit filename')
  assert.equal(fake.constructed.providers[0].options.credentials, fake.constructed.stores[0])
  // normalization applies: dedup + non-http(s) dropped, provider content kept
  assert.deepEqual(
    result.sources,
    [
      { url: 'https://example.com/codex-first', title: 'Codex first', snippet: 'served by codex' },
      { url: 'https://example.com/codex-second', title: 'Codex second' },
      { url: 'https://example.com/codex-third' },
    ],
  )
  assert.equal(result.content, 'provider-generated summary')
  assert.equal(result.truncated, false)
})

test('codex: the wrapped provider is constructed once and reused across searches', async () => {
  const { adapter, fake } = harness({})
  await adapter.search({ query: 'a' }, SIGNAL)
  await adapter.search({ query: 'b' }, SIGNAL)
  assert.equal(fake.constructed.providers.length, 1)
  assert.equal(fake.constructed.stores.length, 1)
})

test('codex: maxResults truncates through the shared normalizer', async () => {
  const { adapter } = harness({})
  const result = await adapter.search({ query: 'q', maxResults: 2 }, SIGNAL)
  assert.deepEqual(
    result.sources.map((s) => s.url),
    ['https://example.com/codex-first', 'https://example.com/codex-second'],
  )
  assert.equal(result.truncated, true)
})

test('codex: a pre-built deps.credentialStore wins over constructing the wrapped store', async () => {
  const { adapter, fake } = harness({}, { credentialStore: { read: async () => FAKE_CREDENTIAL } })
  await adapter.search({ query: 'q' }, SIGNAL)
  assert.equal(fake.constructed.stores.length, 0, 'no store constructed')
  assert.equal(fake.constructed.providers[0].options.credentials.read !== undefined, true)
})

test('codex: deps.codexConnect may be a promise', async () => {
  const fake = fakeCodexConnect({})
  const adapter = createCodexAdapter({ codexConnect: Promise.resolve(fake.mod) })
  const result = await adapter.search({ query: 'q' }, SIGNAL)
  assert.equal(result.sources[0].url, 'https://example.com/codex-first')
  assert.equal(fake.constructed.providers.length, 1)
})

test('codex: without resolveRequestId the adapter supplies a unique one', async () => {
  const { adapter, fake } = harness({})
  await adapter.status() // construction is lazy: realize the provider first
  const resolve = fake.constructed.providers[0].options.resolveRequestId
  assert.equal(typeof resolve, 'function')
  const [first, second] = [resolve(), resolve()]
  assert.equal(first.startsWith('dsh-web-search-router-'), true)
  assert.equal(second.startsWith('dsh-web-search-router-'), true)
  assert.notEqual(first, second)
})

test('codex: a provided resolveRequestId is used verbatim', async () => {
  const { adapter, fake } = harness({}, { resolveRequestId: () => 'session-42' })
  await adapter.search({ query: 'q' }, SIGNAL)
  assert.equal(fake.constructed.providers[0].options.resolveRequestId(), 'session-42')
})

test('codex: WEB_PROVIDER_CREDENTIAL_MISSING maps to auth', async () => {
  const { adapter } = harness({
    search: () => {
      throw webError(
        'WEB_PROVIDER_CREDENTIAL_MISSING',
        'OpenAI Codex search is signed out; run "dsh openai-codex login"',
      )
    },
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.failureClass, 'auth')
    assert.equal(error.retryable, false)
    assert.equal(error.retryAfterMs, undefined)
    return true
  })
})

test('codex: HTTP 429 in the message maps to rate_limit with no retryAfterMs, never retryable', async () => {
  for (const make of [webError, webErrorPlain]) {
    const { adapter } = harness({
      search: () => {
        throw make('WEB_PROVIDER_ERROR', 'OpenAI Codex search failed (HTTP 429)')
      },
    })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.ok(error instanceof AdapterError)
      assert.equal(error.failureClass, 'rate_limit')
      assert.equal(error.retryAfterMs, undefined, 'no structured Retry-After exists on this path')
      assert.equal(error.retryable, false)
      return true
    })
  }
})

test('codex: HTTP 401/403 in the message map to auth even under WEB_PROVIDER_ERROR', async () => {
  for (const status of [401, 403]) {
    const { adapter } = harness({
      search: () => {
        throw webError('WEB_PROVIDER_ERROR', `OpenAI Codex search failed (HTTP ${status}): rejected`)
      },
    })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'auth')
      assert.equal(error.message, `codex: HTTP ${status}`)
      return true
    })
  }
})

test('codex: only 502/503/504 are retryable upstream; 500 stays non-retryable', async () => {
  for (const [status, retryable] of [[500, false], [502, true], [503, true], [504, true]]) {
    const { adapter } = harness({
      search: () => {
        throw webError('WEB_PROVIDER_ERROR', `OpenAI Codex search failed (HTTP ${status})`)
      },
    })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'upstream')
      assert.equal(error.retryable, retryable)
      assert.equal(error.retryAfterMs, undefined)
      return true
    })
  }
})

test('codex: a non-HTTP WebError maps to plain upstream', async () => {
  const { adapter } = harness({
    search: () => {
      throw webError('WEB_PROVIDER_ERROR', 'OpenAI Codex search request failed')
    },
  })
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.equal(error.failureClass, 'upstream')
    assert.equal(error.retryable, false)
    return true
  })
})

test('codex: zero usable http(s) sources map to empty', async () => {
  for (const result of [
    { content: 'text-only answer', sources: [] },
    { sources: [{ url: 'ftp://no-http-support' }] },
  ]) {
    const { adapter } = harness({ search: () => result })
    await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
      assert.equal(error.failureClass, 'empty')
      return true
    })
  }
})

test('codex: the provider WEB_ABORTED error rethrows unclassified for the walk', async () => {
  const { adapter } = harness({
    search: (provider, request, signal) =>
      new Promise((resolve, reject) => {
        const onAbort = () => reject(webError('WEB_ABORTED', 'OpenAI Codex search aborted'))
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }),
  })
  const controller = new AbortController()
  const pending = adapter.search({ query: 'q' }, controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof AdapterAbortError)
    assert.equal(error.failureClass, undefined, 'unclassified: only the walk knows which signal fired')
    return true
  })
})

test('codex: a raw native abort error also rethrows unclassified', async () => {
  const { adapter } = harness({
    search: (provider, request, signal) =>
      new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException('This operation was aborted', 'AbortError'))
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }),
  })
  const controller = new AbortController()
  const pending = adapter.search({ query: 'q' }, controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof AdapterAbortError)
    assert.equal(error.failureClass, undefined)
    return true
  })
})

test('codex: walk-level fall-through — credential missing skips into the next backend', async () => {
  const { adapter } = harness({
    search: () => {
      throw webError(
        'WEB_PROVIDER_CREDENTIAL_MISSING',
        'OpenAI Codex search is signed out; run "dsh openai-codex login"',
      )
    },
  })
  const router = new SearchRouter({ adapters: [adapter, downstreamAdapter('fallback')] })
  const result = await router.search({ query: 'q' })
  assert.equal(result.sources[0].url, 'https://served.by/fallback')
})

test('codex: the walk aborts the wrapped provider long before any 30 s internal deadline', async () => {
  let receivedSignal
  const { adapter } = harness({
    search: (provider, request, signal) =>
      new Promise((resolve, reject) => {
        receivedSignal = signal
        const onAbort = () => reject(webError('WEB_ABORTED', 'OpenAI Codex search aborted'))
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }),
  })
  const router = new SearchRouter({
    adapters: [adapter, downstreamAdapter('after-timeout', 'empty')],
    attemptTimeoutMs: 10, // real timers: the walk's cap, far below the wrapped 30 s deadline
  })
  const startedAt = Date.now()
  await assert.rejects(router.search({ query: 'q' }), (error) => {
    assert.ok(error instanceof ChainExhaustedError)
    assert.deepEqual(
      error.trail.map((t) => [t.backend, t.outcome, t.failureClass]),
      [
        ['codex', 'failed', 'timeout'],
        ['after-timeout', 'failed', 'empty'],
      ],
      'the timeout was classified and the walk fell through',
    )
    return true
  })
  assert.equal(receivedSignal.aborted, true, 'the wrapped provider saw its signal abort')
  assert.ok(Date.now() - startedAt < 5_000, 'nowhere near the wrapped provider\'s internal 30 s deadline')
})

test('codex: import failure is needs-setup — status not ok, search is a config failure', async () => {
  const adapter = createCodexAdapter({
    importCodexConnect: async () => {
      throw new Error("Cannot find package 'dsh-codex-connect'")
    },
  })
  const status = await adapter.status()
  assert.equal(status.ok, false)
  assert.match(status.reason, /dsh-codex-connect unavailable/)
  await assert.rejects(adapter.search({ query: 'q' }, SIGNAL), (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.failureClass, 'config')
    assert.equal(error.message, 'codex: dsh-codex-connect unavailable')
    return true
  })
})

test('codex: import failure never crashes the chain — the walk skips the hop', async () => {
  const adapter = createCodexAdapter({
    importCodexConnect: async () => {
      throw new Error("Cannot find package 'dsh-codex-connect'")
    },
  })
  const router = new SearchRouter({ adapters: [adapter, downstreamAdapter('fallback', 'empty')] })
  await assert.rejects(router.search({ query: 'q' }), (error) => {
    assert.ok(error instanceof ChainExhaustedError)
    assert.deepEqual(
      error.trail.map((t) => [t.backend, t.outcome]),
      [
        ['codex', 'skipped'],
        ['fallback', 'failed'],
      ],
    )
    return true
  })
})

test('codex: unverified compatibility warns once and never disables the backend', async () => {
  const assessments = []
  const logger = capturingLogger()
  const { adapter } = harness(
    {
      assessCompatibility: (input) => {
        assessments.push(input)
        return { status: 'unverified' }
      },
    },
    { compatibilityVersions: COMPAT_VERSIONS, logger },
  )
  assert.deepEqual(await adapter.status(), { ok: true, state: 'ready' })
  const result = await adapter.search({ query: 'q' }, SIGNAL)
  const resultTwo = await adapter.search({ query: 'q2' }, SIGNAL)
  assert.equal(result.sources[0].url, 'https://example.com/codex-first', 'still searchable')
  assert.equal(resultTwo.sources[0].url, 'https://example.com/codex-first')
  assert.equal(assessments.length, 1, 'evaluated exactly once, at first construction')
  assert.equal(assessments[0], COMPAT_VERSIONS)
  assert.equal(logger.entries.warn.length, 1)
  assert.match(logger.entries.warn[0].format, /warn-only/)
  assert.equal(logger.entries.warn[0].args[0], 'unverified')
})

test('codex: incompatible compatibility warns the same way and never disables', async () => {
  const logger = capturingLogger()
  const { adapter } = harness(
    { assessCompatibility: () => ({ status: 'incompatible' }) },
    { compatibilityVersions: COMPAT_VERSIONS, logger },
  )
  const result = await adapter.search({ query: 'q' }, SIGNAL)
  assert.equal(result.sources[0].url, 'https://example.com/codex-first')
  assert.equal(logger.entries.warn.length, 1)
  assert.match(logger.entries.warn[0].format, /warn-only/)
  assert.equal(logger.entries.warn[0].args[0], 'incompatible')
})

test('codex: no supplied host versions skips the check with a debug log, no warning', async () => {
  const logger = capturingLogger()
  const assessments = []
  const { adapter } = harness(
    {
      assessCompatibility: (input) => {
        assessments.push(input)
        return { status: 'compatible' }
      },
    },
    { logger }, // no compatibilityVersions: never guess host versions
  )
  await adapter.search({ query: 'q' }, SIGNAL)
  assert.equal(assessments.length, 0, 'the assessment never ran')
  assert.equal(logger.entries.warn.length, 0)
  assert.equal(logger.entries.debug.length, 1)
  assert.match(logger.entries.debug[0].format, /skipped/)
})

test('codex: a compatible report stays silent', async () => {
  const logger = capturingLogger()
  const { adapter } = harness(
    { assessCompatibility: () => ({ status: 'compatible' }) },
    { compatibilityVersions: COMPAT_VERSIONS, logger },
  )
  await adapter.search({ query: 'q' }, SIGNAL)
  assert.equal(logger.entries.warn.length, 0)
})
