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
  assert.match(out.content, /served by codex/)
})

test('a zai model routes the first hop to the zai backend', async () => {
  const zai = fakeBackend('zai', { result: resultFrom('zai') })
  const exa = fakeBackend('exa', { result: resultFrom('exa') })
  const provider = router({ backends: [zai, exa], model: { provider: 'zai', model: 'glm-5.3' } })
  const out = await provider.search(q('what is dsh'))
  assert.equal(zai.calls.length, 1)
  assert.equal(exa.calls.length, 0)
  assert.match(out.content, /served by zai/)
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
  assert.match(out.content, /served by exa/)
})

test('no model context at all falls back to chain order', async () => {
  const exa = fakeBackend('exa', { result: resultFrom('exa') })
  const provider = router({ backends: [exa], model: undefined })
  const out = await provider.search(q('what is dsh'))
  assert.equal(exa.calls.length, 1)
  assert.match(out.content, /served by exa/)
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
  assert.equal(out.content, 'answer from codex\n\nNote: served by codex (routed by openai-codex/gpt-5.6-luna).')
})

test('with no model context the note omits the routing clause', async () => {
  const exa = fakeBackend('exa', { result: resultFrom('exa') })
  const provider = router({ backends: [exa], model: undefined })
  const out = await provider.search(q('x'))
  assert.equal(out.content, 'answer from exa\n\nNote: served by exa.')
})
