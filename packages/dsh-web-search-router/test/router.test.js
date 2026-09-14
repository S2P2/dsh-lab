import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SearchRouter } from '../src/router.js'
import { AdapterError, SearchAbortedError, ChainExhaustedError } from '../src/errors.js'

/** A recording fake adapter. behavior: 'serve' | {throw: AdapterError} | 'hang' | {status:'needs-setup'} */
function fakeAdapter(id, behavior = 'serve', log = []) {
  return {
    id,
    status() {
      log.push(`${id}:status`)
      return behavior?.status ? { ok: false, reason: behavior.status } : { ok: true }
    },
    async search(request, signal) {
      log.push(`${id}:search`)
      if (behavior === 'serve') {
        return { sources: [{ url: `https://served.by/${id}` }], truncated: false }
      }
      if (behavior === 'hang') {
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(new DOMException('This operation was aborted', 'AbortError'))
          if (signal?.aborted) onAbort()
          else signal?.addEventListener('abort', onAbort, { once: true })
        })
      }
      if (behavior?.throw !== undefined) throw behavior.throw
      throw new Error(`unknown behavior ${behavior}`)
    },
  }
}

const failure = (failureClass, message = `${failureClass} failure`, extra = {}) =>
  new AdapterError(message, failureClass, extra)

test('first success stops the walk', async () => {
  const log = []
  const router = new SearchRouter({
    adapters: [fakeAdapter('a', 'serve', log), fakeAdapter('b', 'serve', log)],
  })
  const result = await router.search({ query: 'q' })
  assert.deepEqual(log, ['a:status', 'a:search'])
  assert.equal(result.sources[0].url, 'https://served.by/a')
})

test('classified failures fall through to the next backend', async () => {
  const log = []
  const router = new SearchRouter({
    adapters: [
      fakeAdapter('a', { throw: failure('auth', 'exa: EXA_API_KEY rejected SECRET-VALUE') }, log),
      fakeAdapter('b', 'serve', log),
    ],
  })
  const result = await router.search({ query: 'q' })
  assert.deepEqual(log, ['a:status', 'a:search', 'b:status', 'b:search'])
  assert.equal(result.sources[0].url, 'https://served.by/b')
})

test('needs-setup backends are skipped without a network attempt', async () => {
  const log = []
  const router = new SearchRouter({
    adapters: [fakeAdapter('a', { status: 'needs setup: missing credential' }, log), fakeAdapter('b', 'serve', log)],
  })
  await router.search({ query: 'q' })
  assert.deepEqual(log, ['a:status', 'b:status', 'b:search'])
})

test('chain exhaustion is sanitized model-facing, detailed host-facing', async () => {
  const lines = []
  const logger = { info: (fmt, ...args) => lines.push({ fmt, args }), debug: () => {} }
  const router = new SearchRouter({
    adapters: [
      fakeAdapter('a', { throw: failure('auth', 'a says SECRET-TOKEN-XYZ') }),
      fakeAdapter('b', { throw: failure('empty', 'b: no sources') }),
    ],
    logger,
  })
  await assert.rejects(router.search({ query: 'q' }), (error) => {
    assert.ok(error instanceof ChainExhaustedError)
    assert.equal(error.message, 'no configured search backend succeeded')
    assert.equal(error.code, 'WEB_PROVIDER_ERROR')
    assert.equal(error.message.includes('SECRET-TOKEN-XYZ'), false, 'no upstream text model-facing')
    assert.deepEqual(
      error.trail.map((t) => [t.backend, t.outcome, t.failureClass]),
      [
        ['a', 'failed', 'auth'],
        ['b', 'failed', 'empty'],
      ],
    )
    return true
  })
  assert.equal(lines.length, 1, 'trail logged to host logger once')
  assert.equal(JSON.stringify(lines[0].args[0]).includes('"a"'), true)
})

test('pre-aborted signal cancels before any adapter work', async () => {
  const log = []
  const router = new SearchRouter({ adapters: [fakeAdapter('a', 'serve', log)] })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(router.search({ query: 'q' }, controller.signal), (error) => {
    assert.ok(error instanceof SearchAbortedError)
    assert.equal(error.code, 'WEB_ABORTED')
    return true
  })
  assert.deepEqual(log, [], 'no status checks, no attempts')
})

test('caller abort mid-attempt is terminal: no fallback, no backend failure recorded', async () => {
  const log = []
  const router = new SearchRouter({
    adapters: [fakeAdapter('a', 'hang', log), fakeAdapter('b', 'serve', log)],
  })
  const controller = new AbortController()
  const pending = router.search({ query: 'q' }, controller.signal)
  // let the hanging attempt start, then cancel the caller
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof SearchAbortedError)
    assert.equal(error.trail, undefined)
    return true
  })
  assert.deepEqual(log, ['a:status', 'a:search'], 'fallback backend never touched')
})

test('attempt deadline classifies timeout and falls through', async () => {
  const log = []
  const router = new SearchRouter({
    adapters: [fakeAdapter('a', 'hang', log), fakeAdapter('b', 'serve', log)],
    attemptTimeoutMs: 15,
  })
  const result = await router.search({ query: 'q' })
  assert.equal(result.sources[0].url, 'https://served.by/b')
  // 'a' timed out: its abort listener fired, classified by the walk as timeout
})

test('timeout failures carry the timeout class in the exhaustion trail', async () => {
  const router = new SearchRouter({
    adapters: [fakeAdapter('a', 'hang'), fakeAdapter('b', 'hang')],
    attemptTimeoutMs: 10,
  })
  await assert.rejects(router.search({ query: 'q' }), (error) => {
    assert.deepEqual(
      error.trail.map((t) => t.failureClass),
      ['timeout', 'timeout'],
    )
    return true
  })
})

test('non-AdapterError throws are recorded as upstream and the walk continues', async () => {
  const log = []
  const router = new SearchRouter({
    adapters: [
      fakeAdapter('a', { throw: new Error('unexpected wire garbage') }, log),
      fakeAdapter('b', 'serve', log),
    ],
  })
  await router.search({ query: 'q' })
  assert.deepEqual(log, ['a:status', 'a:search', 'b:status', 'b:search'])
})

test('empty router chain is unavailable; exhaustion with zero adapters is sanitized', async () => {
  const router = new SearchRouter({ adapters: [] })
  assert.equal(router.available(), false)
  await assert.rejects(router.search({ query: 'q' }), (error) => {
    assert.ok(error instanceof ChainExhaustedError)
    assert.deepEqual(error.trail, [])
    return true
  })
})

test('retryAfterMs from adapter failures rides the trail', async () => {
  const router = new SearchRouter({
    adapters: [fakeAdapter('a', { throw: failure('rate_limit', 'a throttled', { retryAfterMs: 1200 }) })],
  })
  await assert.rejects(router.search({ query: 'q' }), (error) => {
    assert.equal(error.trail[0].retryAfterMs, 1200)
    return true
  })
})
