import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModelResolver } from '../src/model-context.js'

function fakeAgent({ id, header, options }, cleanups) {
  return {
    id,
    options: options ?? {},
    session: {
      requestHeader: () => (header === undefined ? undefined : { config: header }),
    },
    ctx: {
      effect(fn) {
        cleanups.push(fn())
      },
    },
  }
}

function fakeCtx({ initiator, agents = [] } = {}) {
  const cleanups = []
  const listeners = new Map()
  const ctx = {
    agents: {
      currentInitiator: () => initiator,
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(listener)
    },
  }
  ctx.__emit = (event, payload) => (listeners.get(event) ?? []).forEach((l) => l(payload))
  ctx.__cleanups = cleanups
  ctx.__agents = agents
  return ctx
}

test('initiator with a logged header resolves its provider and model', () => {
  const agent = fakeAgent({ id: 's1', header: { provider: 'zai', model: 'glm-5.3' } })
  const ctx = fakeCtx({ initiator: agent })
  const resolve = createModelResolver(ctx)
  assert.deepEqual(resolve(), { provider: 'zai', model: 'glm-5.3' })
})

test('initiator without a header falls back to creation-time agent options', () => {
  const agent = fakeAgent({ id: 's1', header: undefined, options: { provider: 'openai-codex', model: 'gpt-5.6-luna' } })
  const ctx = fakeCtx({ initiator: agent })
  const resolve = createModelResolver(ctx)
  assert.deepEqual(resolve(), { provider: 'openai-codex', model: 'gpt-5.6-luna' })
})

test('no initiator resolves the most recently created tracked agent', () => {
  const ctx = fakeCtx({ initiator: undefined })
  const resolve = createModelResolver(ctx)
  ctx.__emit('agent/created', { agent: fakeAgent({ id: 's1', header: { provider: 'zai', model: 'glm-5.2' } }, ctx.__cleanups) })
  ctx.__emit('agent/created', { agent: fakeAgent({ id: 's2', header: { provider: 'openai-codex', model: 'gpt-5.6-sol' } }, ctx.__cleanups) })
  assert.deepEqual(resolve(), { provider: 'openai-codex', model: 'gpt-5.6-sol' })
})

test('a disposed agent stops being the fallback', () => {
  const ctx = fakeCtx({ initiator: undefined })
  const resolve = createModelResolver(ctx)
  ctx.__emit('agent/created', { agent: fakeAgent({ id: 's1', header: { provider: 'zai', model: 'glm-5.2' } }, ctx.__cleanups) })
  assert.deepEqual(resolve(), { provider: 'zai', model: 'glm-5.2' })
  for (const cleanup of ctx.__cleanups.splice(0)) cleanup()
  assert.equal(resolve(), undefined)
})

test('header provider wins over stale agent options', () => {
  const agent = fakeAgent({
    id: 's1',
    header: { provider: 'zai', model: 'glm-5.3' },
    options: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
  })
  const ctx = fakeCtx({ initiator: agent })
  assert.deepEqual(createModelResolver(ctx)(), { provider: 'zai', model: 'glm-5.3' })
})

test('nothing known resolves undefined (chain order takes over)', () => {
  assert.equal(createModelResolver(fakeCtx({ initiator: undefined }))(), undefined)
})

test('a throwing initiator read degrades instead of failing the search', () => {
  const ctx = fakeCtx({ initiator: undefined })
  ctx.agents.currentInitiator = () => {
    throw new Error('disposed')
  }
  assert.equal(createModelResolver(ctx)(), undefined)
})
