import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSearchRouterProvider } from '../src/router.js'

/** Fake backend: records calls, returns a canned result or throws. */
function fakeBackend(id, { result, error } = {}) {
  const calls = []
  return {
    id,
    calls,
    async availability() {
      return { ok: true }
    },
    async search(request, signal) {
      calls.push({ request, signal })
      if (error) throw error
      return { ...result, sources: result?.sources ?? [], truncated: false }
    },
  }
}

const q = (query) => ({ query })

function resultFrom(id) {
  return { content: `answer from ${id}`, sources: [{ url: `https://${id}/a`, title: 'A' }], truncated: false }
}

function router({ backends, model, modelRoutes, fallbackChain }) {
  return new WebSearchRouterProvider({
    backends: new Map(backends.map((b) => [b.id, b])),
    resolveModel: () => model,
    modelRoutes: modelRoutes ?? { 'openai-codex': 'codex', zai: 'zai' },
    fallbackChain: fallbackChain ?? ['exa', 'tavily', 'ddg'],
  })
}

test('a codex model routes the first hop to the codex backend', async () => {
  const codex = fakeBackend('codex', { result: resultFrom('codex') })
  const exa = fakeBackend('exa', { result: resultFrom('exa') })
  const provider = router({ backends: [codex, exa], model: { provider: 'openai-codex', model: 'gpt-5.6-luna' } })
  const out = await provider.search(q('what is dsh'))
  assert.equal(codex.calls.length, 1)
  assert.equal(exa.calls.length, 0)
  assert.match(out.provenance, /served by codex/)
})

test('a zai model routes the first hop to the zai backend', async () => {
  const zai = fakeBackend('zai', { result: resultFrom('zai') })
  const exa = fakeBackend('exa', { result: resultFrom('exa') })
  const provider = router({ backends: [zai, exa], model: { provider: 'zai', model: 'glm-5.3' } })
  const out = await provider.search(q('what is dsh'))
  assert.equal(zai.calls.length, 1)
  assert.equal(exa.calls.length, 0)
  assert.match(out.provenance, /served by zai/)
})

test('an unmatched model falls straight to the fallback chain', async () => {
  const codex = fakeBackend('codex', { result: resultFrom('codex') })
  const exa = fakeBackend('exa', { result: resultFrom('exa') })
  const provider = router({
    backends: [codex, exa],
    model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  const out = await provider.search(q('what is dsh'))
  assert.equal(codex.calls.length, 0)
  assert.equal(exa.calls.length, 1)
  assert.match(out.provenance, /served by exa/)
})

test('no model context at all falls back to chain order', async () => {
  const exa = fakeBackend('exa', { result: resultFrom('exa') })
  const provider = router({ backends: [exa], model: undefined })
  const out = await provider.search(q('what is dsh'))
  assert.equal(exa.calls.length, 1)
  assert.match(out.provenance, /served by exa/)
})

test('model route matching is by provider id prefix', async () => {
  const zai = fakeBackend('zai', { result: resultFrom('zai') })
  const provider = router({
    backends: [zai],
    model: { provider: 'zai-eu', model: 'glm-5.3' },
  })
  await provider.search(q('x'))
  assert.equal(zai.calls.length, 1)
})

test('the provenance note names the model that drove the routing', async () => {
  const codex = fakeBackend('codex', { result: resultFrom('codex') })
  const provider = router({
    backends: [codex],
    model: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
  })
  const out = await provider.search(q('x'))
  // Clean serve: no note in content (the stock tool projects content to the
  // model; routing trivia is token cost) — provenance rides the result field.
  assert.equal(out.content, 'answer from codex')
  assert.equal(out.provenance, 'served by codex (routed by openai-codex/gpt-5.6-luna)')
})

test('a clean serve is reported through the routing callback but not the content', async () => {
  const seen = []
  const exa = fakeBackend('exa', { result: resultFrom('exa') })
  const provider = new WebSearchRouterProvider({
    backends: new Map([['exa', exa]]),
    resolveModel: () => undefined,
    modelRoutes: {},
    fallbackChain: ['exa'],
    onRouting: (note) => seen.push(note),
  })
  const out = await provider.search(q('x'))
  assert.equal(out.content, 'answer from exa')
  assert.equal(out.provenance, 'served by exa')
  assert.deepEqual(seen, ['served by exa'])
})

test('a degraded serve stays silent in content; the trail rides provenance', async () => {
  const exa = fakeBackend('exa', { error: Object.assign(new Error('HTTP 500'), { status: 500 }) })
  const ddg = fakeBackend('ddg', { result: resultFrom('ddg') })
  const provider = router({ backends: [exa, ddg] })
  const out = await provider.search(q('x'))
  assert.equal(out.content, 'answer from ddg', 'never model-facing, degraded or not')
  assert.equal(out.provenance, 'served by ddg; failed exa (HTTP 500): HTTP 500; skipped tavily (unknown backend id)')
})

test('with no model context the provenance omits the routing clause', async () => {
  const exa = fakeBackend('exa', { result: resultFrom('exa') })
  const provider = router({ backends: [exa], model: undefined })
  const out = await provider.search(q('x'))
  assert.equal(out.provenance, 'served by exa')
})
