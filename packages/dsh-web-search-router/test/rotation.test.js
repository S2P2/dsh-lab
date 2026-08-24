import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSearchRouterProvider } from '../src/router.js'

function fakeBackend(id, { result, error, availability } = {}) {
  const calls = []
  return {
    id,
    calls,
    async availability() {
      return availability ?? { ok: true }
    },
    async search(request) {
      calls.push(request)
      if (error) throw error
      return result
    },
  }
}

const RESULT = (id) => ({ content: `answer ${id}`, sources: [{ url: `https://${id}/1` }], truncated: false })

function router({ backends, model, fallbackChain }) {
  return new WebSearchRouterProvider({
    backends: new Map(backends.map((b) => [b.id, b])),
    resolveModel: () => model,
    modelRoutes: {},
    fallbackChain: fallbackChain ?? backends.map((b) => b.id),
  })
}

test('a failing first backend rotates to the next and the note names both', async () => {
  const exa = fakeBackend('exa', { error: Object.assign(new Error('connect ECONNREFUSED'), { status: undefined }) })
  const tavily = fakeBackend('tavily', { result: RESULT('tavily') })
  const out = await router({ backends: [exa, tavily] }).search({ query: 'q' })
  assert.equal(tavily.calls.length, 1)
  assert.match(out.content, /served by tavily/)
  assert.match(out.content, /failed exa: connect ECONNREFUSED/)
})

test('HTTP status appears in the failure note', async () => {
  const exa = fakeBackend('exa', { error: Object.assign(new Error('quota exceeded'), { status: 429 }) })
  const ddg = fakeBackend('ddg', { result: RESULT('ddg') })
  const out = await router({ backends: [exa, ddg] }).search({ query: 'q' })
  assert.match(out.content, /failed exa \(HTTP 429\)/)
})

test('every failure class rotates: timeout, 401, 429, 5xx', async () => {
  for (const error of [
    Object.assign(new Error('signal aborted'), { status: undefined }),
    Object.assign(new Error('bad key'), { status: 401 }),
    Object.assign(new Error('slow down'), { status: 429, retryAfterMs: 60_000 }),
    Object.assign(new Error('upstream'), { status: 503 }),
  ]) {
    const a = fakeBackend('a', { error })
    const b = fakeBackend('b', { result: RESULT('b') })
    const out = await router({ backends: [a, b] }).search({ query: 'q' })
    assert.match(out.content, /served by b/, `should rotate past ${error.message}`)
  }
})

test('an unavailable backend is skipped with its reason, not tried', async () => {
  const exa = fakeBackend('exa', { availability: { ok: false, reason: 'missing EXA_API_KEY' } })
  const ddg = fakeBackend('ddg', { result: RESULT('ddg') })
  const out = await router({ backends: [exa, ddg] }).search({ query: 'q' })
  assert.equal(exa.calls.length, 0)
  assert.match(out.content, /skipped exa \(missing EXA_API_KEY\)/)
  assert.match(out.content, /served by ddg/)
})

test('signed-out codex is a skip, and the chain carries the search', async () => {
  const codex = fakeBackend('codex', { availability: { ok: false, reason: 'signed out of OpenAI Codex' } })
  const tavily = fakeBackend('tavily', { result: RESULT('tavily') })
  const provider = new WebSearchRouterProvider({
    backends: new Map([
      ['codex', codex],
      ['tavily', tavily],
    ]),
    resolveModel: () => ({ provider: 'openai-codex', model: 'gpt-5.6-sol' }),
    modelRoutes: { 'openai-codex': 'codex' },
    fallbackChain: ['tavily'],
  })
  const out = await provider.search({ query: 'q' })
  assert.equal(codex.calls.length, 0)
  assert.match(out.content, /skipped codex \(signed out of OpenAI Codex\)/)
  assert.match(out.content, /served by tavily/)
})

test('a 429 Retry-After puts the backend on cooldown for the next search', async () => {
  let clock = 1_000
  const exa = fakeBackend('exa', {
    error: Object.assign(new Error('rate limited'), { status: 429, retryAfterMs: 5_000 }),
  })
  const ddg = fakeBackend('ddg', { result: RESULT('ddg') })
  const provider = new WebSearchRouterProvider({
    backends: new Map([
      ['exa', exa],
      ['ddg', ddg],
    ]),
    resolveModel: () => undefined,
    modelRoutes: {},
    fallbackChain: ['exa', 'ddg'],
    now: () => clock,
  })
  const first = await provider.search({ query: 'q' })
  assert.match(first.content, /failed exa \(HTTP 429\)/)
  const second = await provider.search({ query: 'q' })
  assert.equal(exa.calls.length, 1, 'cooling backend is not retried')
  assert.match(second.content, /skipped exa \(rate-limited, cooling down\)/)
  clock += 5_001
  const third = await provider.search({ query: 'q' })
  assert.equal(exa.calls.length, 2, 'cooldown expiry releases the backend')
  assert.doesNotMatch(third.content, /cooling down/)
})

test('when every backend fails the last error is thrown', async () => {
  const exa = fakeBackend('exa', { error: Object.assign(new Error('first failure'), { status: 500 }) })
  const ddg = fakeBackend('ddg', { error: Object.assign(new Error('final failure'), { status: 503 }) })
  await assert.rejects(
    router({ backends: [exa, ddg] }).search({ query: 'q' }),
    /final failure/,
  )
})

test('unknown backend ids in the chain are noted, not fatal', async () => {
  const ddg = fakeBackend('ddg', { result: RESULT('ddg') })
  const out = await router({ backends: [ddg], fallbackChain: ['nope', 'ddg'] }).search({ query: 'q' })
  assert.match(out.content, /skipped nope \(unknown backend id\)/)
  assert.match(out.content, /served by ddg/)
})

test('a clean first-hop success injects nothing into content; provenance rides the result', async () => {
  const exa = fakeBackend('exa', { result: { sources: [{ url: 'https://x/1' }], truncated: false } })
  const out = await router({ backends: [exa] }).search({ query: 'q' })
  assert.equal(out.content, undefined)
  assert.equal(out.provenance, 'served by exa')
})

test('available() is a cheap local check with no network or key resolution', () => {
  const exa = fakeBackend('exa')
  const provider = router({ backends: [exa] })
  assert.equal(provider.available(), true)
  assert.equal(router({ backends: [], fallbackChain: [] }).available(), false)
})
