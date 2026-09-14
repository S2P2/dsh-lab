import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SearchRouter } from '../src/router.js'
import { AdapterError, SearchAbortedError, ChainExhaustedError } from '../src/errors.js'
import {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_OVERALL_TIMEOUT_MS,
  isRetryable,
  retryDelayMs,
  clampAttemptTimeoutMs,
} from '../src/policy.js'

/**
 * Ticket #87 acceptance: one-retry transient policy, randomized delay under
 * an injected clock/scheduler, 15 s budget math, 5 s attempt caps,
 * Retry-After honoring, caller abort at every stage.
 */

/** Deterministic clock + scheduler: timers fire when `advance` crosses them. */
function fakeClock(startAt = 1_000_000) {
  let t = startAt
  const timers = new Set()
  const schedule = {
    setTimeout(fn, ms) {
      const timer = { due: t + ms, fn, cleared: false }
      timers.add(timer)
      return timer
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true
    },
  }
  async function advance(ms) {
    const target = t + ms
    // Drain pending microtasks first so continuations schedule their timers
    // against the current fake time, not the post-advance time.
    await new Promise((resolve) => setImmediate(resolve))
    for (;;) {
      let next
      for (const timer of timers) {
        if (!timer.cleared && timer.due <= target && (next === undefined || timer.due < next.due)) next = timer
      }
      if (next === undefined) break
      next.cleared = true
      t = next.due
      next.fn()
      await new Promise((resolve) => setImmediate(resolve))
    }
    t = target
    await new Promise((resolve) => setImmediate(resolve))
  }
  return { schedule, now: () => t, advance }
}

/** Fake adapter with scripted per-call behaviors; records calls. */
function scripted(id, behaviors) {
  const calls = { search: 0, status: 0 }
  const router = {
    id,
    status() {
      calls.status++
      return { ok: true }
    },
    async search(request, signal) {
      calls.search++
      const behavior = behaviors[Math.min(calls.search - 1, behaviors.length - 1)]
      if (behavior === 'serve') return { sources: [{ url: `https://served.by/${id}` }], truncated: false }
      if (behavior === 'hang') {
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(new DOMException('This operation was aborted', 'AbortError'))
          if (signal?.aborted) onAbort()
          else signal?.addEventListener('abort', onAbort, { once: true })
        })
      }
      throw behavior
    },
  }
  return { adapter: router, calls }
}

const failure = (failureClass, extra = {}) => new AdapterError(`${failureClass} failure`, failureClass, extra)

test('policy units: never-retry classes, retryable flag, delay, clamp', () => {
  for (const failureClass of ['config', 'auth', 'quota', 'rate_limit', 'timeout', 'malformed', 'empty']) {
    assert.equal(isRetryable(failure(failureClass, { retryable: true })), false, `${failureClass} never retried even if mislabeled`)
  }
  assert.equal(isRetryable(failure('network', { retryable: true })), true)
  assert.equal(isRetryable(failure('upstream', { retryable: true })), true)
  assert.equal(isRetryable(failure('network')), false, 'flag required')
  assert.equal(isRetryable(new Error('not an adapter error')), false)
  assert.equal(isRetryable(failure('rate_limit', { retryable: true, retryAfterMs: 5 })), false)

  assert.equal(retryDelayMs({ baseMs: 200, jitterMs: 300, rand: () => 0 }), 200)
  assert.equal(retryDelayMs({ baseMs: 200, jitterMs: 300, rand: () => 1 }), 500)
  assert.equal(clampAttemptTimeoutMs(5000, 15000), 5000)
  assert.equal(clampAttemptTimeoutMs(5000, 3000.4), 3001, 'remaining budget is ceil-ed')
  assert.equal(clampAttemptTimeoutMs(5000, 0), 0)
  assert.equal(DEFAULT_ATTEMPT_TIMEOUT_MS, 5000)
  assert.equal(DEFAULT_OVERALL_TIMEOUT_MS, 15000)
})

test('retryable transport failure is retried exactly once, with randomized delay', async () => {
  const clock = fakeClock()
  const a = scripted('a', [failure('network', { retryable: true }), 'serve'])
  const delays = []
  const schedule = {
    setTimeout: (fn, ms) => {
      delays.push(ms)
      return clock.schedule.setTimeout(fn, ms)
    },
    clearTimeout: clock.schedule.clearTimeout,
  }
  const router = new SearchRouter({
    adapters: [a.adapter],
    now: clock.now,
    schedule,
    retry: { baseMs: 200, jitterMs: 300, rand: () => 0.5 },
  })
  const pending = router.search({ query: 'q' })
  await clock.advance(400)
  const result = await pending
  assert.equal(result.sources[0].url, 'https://served.by/a')
  assert.equal(a.calls.search, 2)
  assert.equal(delays[0], 5000, 'attempt deadline timer scheduled first')
  assert.equal(delays[1], 350, 'deterministic randomized retry delay: 200 + 0.5*300')
})

test('retry trail records retries count and both attempts', async () => {
  const clock = fakeClock()
  const a = scripted('a', [failure('upstream', { retryable: true }), failure('upstream', { retryable: true })])
  const b = scripted('b', [failure('auth')])
  const router = new SearchRouter({
    adapters: [a.adapter, b.adapter],
    now: clock.now,
    schedule: clock.schedule,
    retry: { baseMs: 100, jitterMs: 0, rand: () => 0 },
  })
  const pending = router.search({ query: 'q' }).catch((error) => error)
  await clock.advance(500)
  const error = await pending
  assert.ok(error instanceof ChainExhaustedError)
  assert.deepEqual(
    error.trail.map((t) => [t.backend, t.outcome, t.failureClass, t.retries]),
    [
      ['a', 'failed', 'upstream', 0],
      ['a', 'failed', 'upstream', 1],
      ['b', 'failed', 'auth', 0],
    ],
  )
})

test('after the one retry, failure falls through to the next backend', async () => {
  const clock = fakeClock()
  const a = scripted('a', [failure('network', { retryable: true }), failure('network', { retryable: true }), 'serve'])
  const b = scripted('b', ['serve'])
  const router = new SearchRouter({
    adapters: [a.adapter, b.adapter],
    now: clock.now,
    schedule: clock.schedule,
    retry: { baseMs: 100, jitterMs: 0, rand: () => 0 },
  })
  const pending = router.search({ query: 'q' })
  await clock.advance(500)
  const result = await pending
  assert.equal(result.sources[0].url, 'https://served.by/b')
  assert.equal(a.calls.search, 2, 'exactly one retry for the transient failure')
  assert.equal(b.calls.search, 1)
})

test('never-retry classes fall through immediately (no second attempt)', async () => {
  for (const failureClass of ['auth', 'quota', 'rate_limit', 'malformed', 'empty', 'config']) {
    const a = scripted('a', [failure(failureClass), failure(failureClass), failure(failureClass)])
    const b = scripted('b', ['serve'])
    const router = new SearchRouter({ adapters: [a.adapter, b.adapter] })
    const result = await router.search({ query: 'q' })
    assert.equal(a.calls.search, 1, `${failureClass}: single attempt`)
    assert.equal(result.sources[0].url, 'https://served.by/b')
  }
})

test('timeout failures are never retried; the backend falls back immediately', async () => {
  const clock = fakeClock()
  const a = scripted('a', ['hang', 'hang', 'hang'])
  const b = scripted('b', ['serve'])
  const router = new SearchRouter({
    adapters: [a.adapter, b.adapter],
    now: clock.now,
    schedule: clock.schedule,
    attemptTimeoutMs: 5000,
  })
  const pending = router.search({ query: 'q' })
  await clock.advance(5000)
  const result = await pending
  assert.equal(a.calls.search, 1, 'timeout: exactly one attempt, no retry')
  assert.equal(result.sources[0].url, 'https://served.by/b')
})

test('15s budget: attempt caps clamp to remaining; no work starts after exhaustion', async () => {
  const clock = fakeClock()
  const adapters = ['a', 'b', 'c'].map((id) => scripted(id, ['hang']))
  const d = scripted('d', ['serve'])
  const attemptDelays = []
  const schedule = {
    setTimeout: (fn, ms) => {
      attemptDelays.push(ms)
      return clock.schedule.setTimeout(fn, ms)
    },
    clearTimeout: clock.schedule.clearTimeout,
  }
  const router = new SearchRouter({
    adapters: [...adapters.map((x) => x.adapter), d.adapter],
    now: clock.now,
    schedule,
    attemptTimeoutMs: 8000, // clamped: 8000, then 7000, then 0 -> skipped
    overallTimeoutMs: 15000,
  })
  const pending = router.search({ query: 'q' }).catch((error) => error)
  await clock.advance(15000)
  const error = await pending
  assert.ok(error instanceof ChainExhaustedError)
  assert.deepEqual(attemptDelays.slice(0, 2), [8000, 7000], 'attempt caps clamped to remaining budget')
  assert.equal(adapters[2].calls.search, 0, 'third hanging backend never started: no budget left')
  assert.equal(d.calls.search, 0, 'no work after deadline exhaustion')
  assert.deepEqual(
    error.trail.map((t) => [t.backend, t.outcome, t.failureClass ?? t.reason]),
    [
      ['a', 'failed', 'timeout'],
      ['b', 'failed', 'timeout'],
      ['c', 'skipped', 'overall deadline exhausted'],
    ],
  )
})

test('retry delays consume the budget; a delay that no longer fits skips the retry', async () => {
  const clock = fakeClock()
  const b = scripted('b', ['serve'])
  const waits = []
  const schedule = {
    setTimeout: (fn, ms) => {
      waits.push(ms)
      return clock.schedule.setTimeout(fn, ms)
    },
    clearTimeout: clock.schedule.clearTimeout,
  }
  let calls = 0
  const a = {
    id: 'a',
    status: () => ({ ok: true }),
    async search() {
      calls++
      if (calls === 1) throw failure('upstream', { retryable: true, retryAfterMs: 20000 })
      return { sources: [{ url: 'https://served.by/a' }], truncated: false }
    },
  }
  const router = new SearchRouter({
    adapters: [a, b.adapter],
    now: clock.now,
    schedule,
    overallTimeoutMs: 15000,
  })
  const pending = router.search({ query: 'q' })
  await clock.advance(100)
  const result = await pending
  assert.equal(result.sources[0].url, 'https://served.by/b', 'retry skipped: delay exceeds deadline')
  assert.equal(calls, 1)
  assert.equal(waits.includes(20000), false, 'no 20s retry wait was ever scheduled')
})

test('structured Retry-After within budget is used as the retry delay', async () => {
  const clock = fakeClock()
  let calls = 0
  const a = {
    id: 'a',
    status: () => ({ ok: true }),
    async search() {
      calls++
      if (calls === 1) throw failure('upstream', { retryable: true, retryAfterMs: 1000 })
      return { sources: [{ url: 'https://served.by/a' }], truncated: false }
    },
  }
  const waits = []
  const schedule = {
    setTimeout: (fn, ms) => {
      waits.push(ms)
      return clock.schedule.setTimeout(fn, ms)
    },
    clearTimeout: clock.schedule.clearTimeout,
  }
  const router = new SearchRouter({ adapters: [a], now: clock.now, schedule, retry: { baseMs: 200, jitterMs: 300, rand: () => 1 } })
  const pending = router.search({ query: 'q' })
  await clock.advance(1500)
  const result = await pending
  assert.equal(result.sources[0].url, 'https://served.by/a')
  assert.equal(calls, 2)
  assert.equal(waits[0], 5000, 'attempt deadline first')
  assert.equal(waits[1], 1000, 'Retry-After wins over the randomized default delay (200+1*300)')
})

test('caller abort during a retry delay is terminal and never a backend failure', async () => {
  const clock = fakeClock()
  const a = scripted('a', [failure('network', { retryable: true }), 'serve'])
  const b = scripted('b', ['serve'])
  const router = new SearchRouter({
    adapters: [a.adapter, b.adapter],
    now: clock.now,
    schedule: clock.schedule,
    retry: { baseMs: 5000, jitterMs: 0, rand: () => 0 },
  })
  const controller = new AbortController()
  const pending = router.search({ query: 'q' }, controller.signal)
  const settled = pending.then(
    () => new Error('expected rejection'),
    (error) => error,
  )
  await new Promise((resolve) => setImmediate(resolve))
  await clock.advance(100) // inside the retry delay now
  controller.abort()
  await clock.advance(10000)
  const error = await settled
  assert.ok(error instanceof SearchAbortedError)
  assert.equal(a.calls.search, 1, 'retry never ran')
  assert.equal(b.calls.search, 0, 'no fallback after abort')
})

test('adapter-internal repair within one search call is a single attempt', async () => {
  const a = scripted('a', ['repair-inside'])
  const custom = {
    id: 'a',
    status: () => ({ ok: true }),
    async search() {
      // simulate: first internal wire try fails, adapter repairs (e.g. session
      // re-init) and succeeds — all inside this one call
      return { sources: [{ url: 'https://served.by/a' }], truncated: false }
    },
  }
  const router = new SearchRouter({ adapters: [custom] })
  const result = await router.search({ query: 'q' })
  assert.equal(result.sources[0].url, 'https://served.by/a')
})

test('zero-delay Retry-After retries immediately', async () => {
  let calls = 0
  const a = {
    id: 'a',
    status: () => ({ ok: true }),
    async search() {
      calls++
      if (calls === 1) throw failure('upstream', { retryable: true, retryAfterMs: 0 })
      return { sources: [{ url: 'https://served.by/a' }], truncated: false }
    },
  }
  const waits = []
  const router = new SearchRouter({
    adapters: [a],
    schedule: {
      setTimeout: (fn, ms) => {
        waits.push(ms)
        return setTimeout(fn, ms)
      },
      clearTimeout,
    },
  })
  const result = await router.search({ query: 'q' })
  assert.equal(result.sources[0].url, 'https://served.by/a')
  assert.equal(calls, 2)
  assert.deepEqual(waits, [5000, 5000], 'two attempt-deadline timers, no wait timer for a 0ms delay')
})
