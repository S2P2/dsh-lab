import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_NAMESPACE,
  defaultBackendOrder,
  normalizeBackendOrder,
  resolveEffectiveSettings,
  createSettingsHost,
  buildSettingsSchema,
} from '../src/settings.js'
import { SearchRouter } from '../src/router.js'
import { apply, inject } from '../src/index.js'
import { CANONICAL_ORDER } from '../src/adapters/index.js'

/**
 * Ticket #91 acceptance: default resolution + live application (next-search
 * semantics, snapshot determinism), all normalization cases, disabling
 * preserves position, knobs observably affect caps/budget/retries, settings
 * change clears affected backend health (forward-compat hook).
 */

test('defaultBackendOrder mirrors the canonical order, all enabled', () => {
  assert.deepEqual(
    defaultBackendOrder().map((b) => b.id),
    CANONICAL_ORDER,
  )
  assert.ok(defaultBackendOrder().every((b) => b.enabled === true))
})

test('absent stored configuration resolves to canonical defaults', () => {
  assert.deepEqual(normalizeBackendOrder(undefined), defaultBackendOrder())
  assert.deepEqual(normalizeBackendOrder(null), defaultBackendOrder())
  assert.deepEqual(normalizeBackendOrder('garbage'), defaultBackendOrder())
})

test('unknown ids ignored with a diagnostic; duplicates collapse to first occurrence', () => {
  const diagnostics = []
  const normalized = normalizeBackendOrder(
    [
      { id: 'exa', enabled: false },
      { id: 'brave', enabled: true }, // unknown
      { id: 'exa', enabled: true }, // duplicate: first (disabled) wins
      null,
      'not-an-object',
      { id: 'duckduckgo', enabled: true },
    ],
    undefined,
    { onDiagnostic: (message) => diagnostics.push(message) },
  )
  assert.deepEqual(
    normalized.map((b) => [b.id, b.enabled]),
    [
      ['exa', false],
      ['duckduckgo', true],
      ['tavily', true],
      ['codex', true],
      ['zai', true],
      ['searxng', true],
    ],
  )
  assert.equal(diagnostics.filter((d) => d.includes('brave')).length, 1)
  assert.equal(diagnostics.filter((d) => d.includes('duplicate')).length, 1)
  assert.equal(diagnostics.filter((d) => d.includes('malformed')).length, 2)
})

test('newly known backends are appended with their default enabled state', () => {
  const stored = [{ id: 'duckduckgo', enabled: false }] // an old settings doc from before other hops existed
  const normalized = normalizeBackendOrder(stored)
  assert.deepEqual(
    normalized.map((b) => [b.id, b.enabled]),
    [
      ['duckduckgo', false],
      ...CANONICAL_ORDER.filter((id) => id !== 'duckduckgo').map((id) => [id, true]),
    ],
  )
})

test('disabling preserves position; order mutates order', () => {
  const stored = [
    { id: 'searxng', enabled: false },
    { id: 'exa', enabled: true },
  ]
  const normalized = normalizeBackendOrder(stored)
  assert.deepEqual(
    normalized.map((b) => b.id),
    ['searxng', 'exa', ...CANONICAL_ORDER.filter((id) => id !== 'searxng' && id !== 'exa')],
  )
})

test('malformed enabled values default to enabled; explicit false honored', () => {
  const normalized = normalizeBackendOrder([
    { id: 'exa', enabled: 'yes' },
    { id: 'tavily', enabled: false },
  ])
  assert.equal(normalized.find((b) => b.id === 'exa').enabled, true)
  assert.equal(normalized.find((b) => b.id === 'tavily').enabled, false)
})

test('resolveEffectiveSettings clamps knobs and passes the searxng url through', () => {
  const effective = resolveEffectiveSettings({
    backends: [],
    attemptTimeoutMs: 2000,
    overallTimeoutMs: 9000,
    maxRetriesPerBackend: 0,
    searxng: { baseUrl: '  https://searxng.example  ' },
  })
  assert.equal(effective.attemptTimeoutMs, 2000)
  assert.equal(effective.overallTimeoutMs, 9000)
  assert.equal(effective.maxRetries, 0)
  assert.equal(effective.searxngBaseUrl, 'https://searxng.example')
  const fallback = resolveEffectiveSettings({ attemptTimeoutMs: -5, overallTimeoutMs: 'big', maxRetriesPerBackend: 1.5 })
  assert.equal(fallback.attemptTimeoutMs, 5000)
  assert.equal(fallback.overallTimeoutMs, 15000)
  assert.equal(fallback.maxRetries, 1.5, 'non-integer retries pass through floor at use site')
  assert.equal(resolveEffectiveSettings(undefined).maxRetries, 1)
})

/** A schemastery stand-in: chainable, marks whatever it builds; never thenable. */
const fakeZ = () => {
  const node = (extra = {}) =>
    new Proxy(
      { schema: true, ...extra },
      {
        get(target, prop) {
          if (prop === 'then' || prop === 'catch' || prop === Symbol.toPrimitive) return undefined
          if (prop in target) return target[prop]
          return (...args) => node({ via: `${String(prop)}` })
        },
      },
    )
  return node()
}

test('buildSettingsSchema builds from an injected schemastery z', () => {
  const schema = buildSettingsSchema(fakeZ())
  assert.equal(schema.schema, true)
})

test('createSettingsHost installs the namespace and snapshots the source', async () => {
  const installs = []
  const changes = []
  let sourceThunk
  const host = createSettingsHost({
    entry: { attemptTimeoutMs: 4000 },
    importSchema: async () => ({ default: fakeZ() }),
    onEffectiveChange: () => changes.push(true),
    logger: { warn: () => {} },
  })
  await host.install((ns, schema, entry, hooks) => {
    installs.push({ ns, schema, entry, hooks })
    hooks.setSource(() => ({ backends: [{ id: 'exa', enabled: true }], attemptTimeoutMs: 2500 }))
    hooks.onChange()
  })
  assert.equal(installs.length, 1)
  assert.equal(installs[0].ns, SETTINGS_NAMESPACE)
  assert.equal(SETTINGS_NAMESPACE, 'web-search-router')
  assert.equal(installs[0].entry.attemptTimeoutMs, 4000, 'composition entry is the base layer')
  assert.equal(changes.length, 1, 'onChange fires the effective-change hook')
  const snapshot = host.snapshot()
  assert.equal(snapshot.attemptTimeoutMs, 2500)
  assert.deepEqual(snapshot.backends.map((b) => b.id), CANONICAL_ORDER, 'normalization fills the rest')
})

test('host degrades to defaults when the schema import fails or the source throws', async () => {
  const warnings = []
  const host = createSettingsHost({
    importSchema: async () => {
      throw new Error('schemastery unavailable')
    },
    logger: { warn: (fmt, ...args) => warnings.push(args[0]) },
  })
  await host.install(() => assert.fail('install must not be reached'))
  assert.equal(warnings.length, 1)
  assert.deepEqual(host.snapshot().backends, defaultBackendOrder())

  const host2 = createSettingsHost({ importSchema: async () => ({ default: fakeZ() }), logger: { warn: () => {} } })
  await host2.install((ns, schema, entry, hooks) => hooks.setSource(() => {
    throw new Error('stale document')
  }))
  assert.equal(host2.snapshot().attemptTimeoutMs, 5000)
})

function fakeAdapter(id, log = []) {
  return {
    id,
    status: () => ({ ok: true }),
    async search() {
      log.push(id)
      return { sources: [{ url: `https://served.by/${id}` }], truncated: false }
    },
  }
}

test('router honors settings order/enabled and knobs from the per-search snapshot', async () => {
  const log = []
  let configuration
  const router = new SearchRouter({
    adapters: [fakeAdapter('exa', log), fakeAdapter('tavily', log), fakeAdapter('duckduckgo', log)],
    resolveConfiguration: () => configuration,
  })
  configuration = { backends: [{ id: 'tavily', enabled: true }, { id: 'exa', enabled: false }, { id: 'duckduckgo', enabled: true }] }
  await router.search({ query: 'q' })
  assert.deepEqual(log, ['tavily'], 'order from settings; disabled exa skipped')

  log.length = 0
  configuration = { backends: [{ id: 'duckduckgo', enabled: true }] }
  await router.search({ query: 'q' })
  assert.deepEqual(log, ['duckduckgo'], 'next search uses the new snapshot')

  log.length = 0
  configuration = { backends: [{ id: 'brave', enabled: true }, { id: 'exa', enabled: true }] }
  await router.search({ query: 'q' })
  assert.deepEqual(log, ['exa'], 'unknown ids drop out; known ones still attempted')
})

test('settings snapshot knobs observably cap attempts and budget', async () => {
  const clock = { t: 1_000_000, timers: new Set() }
  const schedule = {
    setTimeout(fn, ms) {
      const timer = { due: clock.t + ms, fn, cleared: false }
      clock.timers.add(timer)
      return timer
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true
    },
  }
  const now = () => clock.t
  const advance = async (ms) => {
    const target = clock.t + ms
    await new Promise((resolve) => setImmediate(resolve))
    for (;;) {
      let next
      for (const timer of clock.timers) {
        if (!timer.cleared && timer.due <= target && (next === undefined || timer.due < next.due)) next = timer
      }
      if (next === undefined) break
      next.cleared = true
      clock.t = next.due
      next.fn()
      await new Promise((resolve) => setImmediate(resolve))
    }
    clock.t = target
    await new Promise((resolve) => setImmediate(resolve))
  }
  const hang = (id) => ({
    id,
    status: () => ({ ok: true }),
    search: (request, signal) =>
      new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException('aborted', 'AbortError'))
        if (signal?.aborted) onAbort()
        else signal?.addEventListener('abort', onAbort, { once: true })
      }),
  })
  const attemptDelays = []
  const trackingSchedule = {
    setTimeout: (fn, ms) => {
      attemptDelays.push(ms)
      return schedule.setTimeout(fn, ms)
    },
    clearTimeout: schedule.clearTimeout,
  }
  const router = new SearchRouter({
    adapters: [hang('exa'), hang('tavily')],
    resolveConfiguration: () => ({ backends: [{ id: 'exa', enabled: true }, { id: 'tavily', enabled: true }], attemptTimeoutMs: 3000, overallTimeoutMs: 5000 }),
    now,
    schedule: trackingSchedule,
  })
  const pending = router.search({ query: 'q' }).catch((error) => error)
  await advance(5000)
  const error = await pending
  assert.equal(error.name, 'ChainExhaustedError')
  assert.deepEqual(attemptDelays, [3000, 2000], 'attempt cap and remaining-budget clamp come from the snapshot')
})

test('mid-search settings changes never mutate an in-flight search', async () => {
  const clock = { t: 1_000_000, timers: new Set() }
  const schedule = {
    setTimeout(fn, ms) {
      const timer = { due: clock.t + ms, fn, cleared: false }
      clock.timers.add(timer)
      return timer
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true
    },
  }
  const now = () => clock.t
  const advance = async (ms) => {
    const target = clock.t + ms
    await new Promise((resolve) => setImmediate(resolve))
    for (;;) {
      let next
      for (const timer of clock.timers) {
        if (!timer.cleared && timer.due <= target && (next === undefined || timer.due < next.due)) next = timer
      }
      if (next === undefined) break
      next.cleared = true
      clock.t = next.due
      next.fn()
      await new Promise((resolve) => setImmediate(resolve))
    }
    clock.t = target
    await new Promise((resolve) => setImmediate(resolve))
  }
  const serving = (id) => ({
    id,
    status: () => ({ ok: true }),
    async search() {
      return { sources: [{ url: `https://served.by/${id}` }], truncated: false }
    },
  })
  const slowThenServe = (id, delayMs) => ({
    id,
    status: () => ({ ok: true }),
    search: (request, signal) =>
      new Promise((resolve, reject) => {
        const timer = schedule.setTimeout(() => resolve({ sources: [{ url: `https://served.by/${id}` }], truncated: false }), delayMs)
        signal?.addEventListener('abort', () => {
          schedule.clearTimeout(timer)
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      }),
  })
  let configuration = { backends: [{ id: 'slow', enabled: true }, { id: 'fast', enabled: true }] }
  const router = new SearchRouter({
    adapters: [slowThenServe('slow', 1000), serving('fast')],
    resolveConfiguration: () => configuration,
    now,
    schedule,
  })
  const pending = router.search({ query: 'q' })
  await new Promise((resolve) => setImmediate(resolve))
  configuration = { backends: [{ id: 'fast', enabled: true }] } // user edits settings mid-search
  await advance(1100)
  const result = await pending
  assert.equal(result.sources[0].url, 'https://served.by/slow', 'in-flight search keeps its start-of-search snapshot')
})

test('apply wires the settings namespace through an injected settings service', async () => {
  const installs = []
  const settingsService = {
    installSection: (owner, ns, schema, entry, hooks) => installs.push({ owner, ns, schema, entry, hooks }),
  }
  const registered = []
  const ctx = {
    web: { registerSearchProvider: (provider) => registered.push(provider) },
    credentials: { resolve: async () => undefined },
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  }
  apply(ctx, {}, {
    settingsService,
    importSchema: async () => ({ default: fakeZ() }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => undefined },
      text: async () => '<html><body>no results</body></html>',
    }),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(installs.length, 1)
  assert.equal(installs[0].ns, 'web-search-router')
  assert.equal(registered[0].id, 'web-search-router')
  assert.deepEqual(inject, ['web', 'credentials', 'settings'])
  // settings order reaches the next search: only duckduckgo enabled ⇒ exa/tavily not consulted
  installs[0].hooks.setSource(() => ({ backends: [{ id: 'duckduckgo', enabled: true }] }))
  installs[0].hooks.onChange()
  const exaFetches = []
  await assert.rejects(registered[0].search({ query: 'q' }), (error) => {
    assert.equal(error.message, 'no configured search backend succeeded')
    return true
  })
  assert.equal(exaFetches.length, 0)
})

test('apply without a settings service still registers and serves (defaults)', async () => {
  const registered = []
  const ctx = {
    web: { registerSearchProvider: (provider) => registered.push(provider) },
    logger: { info: () => {} },
  }
  apply(ctx, {}, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => undefined },
      text: async () =>
        '<div class="result results_links"><div class="links_main"><h2><a class="result__a" href="https://a.example/x">T</a></h2><a class="result__snippet" href="#">S</a><div class="clear"></div></div></div>',
    }),
  })
  const result = await registered[0].search({ query: 'q' })
  assert.equal(result.sources[0].url, 'https://a.example/x')
})
