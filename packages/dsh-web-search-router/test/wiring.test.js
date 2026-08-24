import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBackends, Config } from '../src/index.js'
import { WebSearchRouterProvider } from '../src/router.js'
import { SEARXNG_INSTANCES } from '../src/backends.js'

/**
 * Wiring tests: the apply()/buildBackends() layer the hermetic seam tests
 * deliberately don't cover (review finding on PR #9 — both blocking defects
 * lived exactly here). No network: availability() is a local check by
 * contract, and the fetch impl is injected.
 */

const fakeCtx = () => ({
  credentials: { resolve: async () => undefined },
})

const noNetwork = async () => {
  throw new Error('wiring test must not touch the network')
}

const fakeCodexAuth = () => ({
  hasCredential: async () => false,
  getAuth: async () => undefined,
})

test('default config builds all six backends and the searxng keyless tail is live', async () => {
  const backends = buildBackends(fakeCtx(), Config({}), { fetchImpl: noNetwork, codexAuth: fakeCodexAuth() })
  assert.deepEqual([...backends.keys()].sort(), ['codex', 'ddg', 'exa', 'searxng', 'tavily', 'zai'])
  // Review finding 1: an absent searxng config must fall through to the
  // public-instance default, not disable the backend (DDG-only tail).
  const availability = await backends.get('searxng').availability()
  assert.equal(availability.ok, true, 'searxng serves with zero config')
})

test('an explicit searxng instances config is honored', async () => {
  const config = Config({ searxng: { instances: ['https://my-instance'] } })
  const backends = buildBackends(fakeCtx(), config, { fetchImpl: noNetwork, codexAuth: fakeCodexAuth() })
  const availability = await backends.get('searxng').availability()
  assert.equal(availability.ok, true)
  // The configured instance is the one asked: search against the injected
  // fetch and assert the URL it received.
  const seenUrls = []
  const recordingFetch = async (url) => {
    seenUrls.push(String(url))
    throw new Error('stop after first request')
  }
  const explicit = buildBackends(fakeCtx(), config, { fetchImpl: recordingFetch, codexAuth: fakeCodexAuth() })
  await explicit.get('searxng').search({ query: 'q' }).catch(() => undefined)
  assert.equal(seenUrls[0], 'https://my-instance/search?q=q&format=json')
})

test('total failure surfaces the full trail through the provider (wiring-level regression)', async () => {
  const seen = []
  const failing = (id) => ({
    id,
    async availability() {
      return { ok: true }
    },
    async search() {
      throw Object.assign(new Error(`${id} down`), { status: 503 })
    },
  })
  const provider = new WebSearchRouterProvider({
    backends: new Map([['exa', failing('exa')], ['ddg', failing('ddg')]]),
    resolveModel: () => undefined,
    modelRoutes: {},
    fallbackChain: ['exa', 'ddg'],
    onRouting: (note) => seen.push(note),
  })
  await assert.rejects(provider.search({ query: 'q' }), (error) => {
    assert.match(error.message, /chain exhausted \[exa → ddg\]/)
    assert.match(error.message, /failed exa/)
    assert.match(error.message, /failed ddg/)
    return true
  })
  assert.match(seen[0], /chain exhausted/)
})

test('SEARXNG_INSTANCES default list is non-empty and https-only', () => {
  assert.ok(SEARXNG_INSTANCES.length > 0)
  for (const instance of SEARXNG_INSTANCES) assert.match(instance, /^https:\/\//)
})
