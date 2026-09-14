import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name } from '../src/index.js'

/**
 * Wiring tests: the apply() layer hermetic seam tests usually can't cover.
 * No network: the fetch impl is injected through `overrides`.
 */

const DDG_PAGE = `
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fwired&amp;rut=x">Wired result</a>
      </h2>
      <a class="result__snippet" href="#">Serving through the router</a>
      <div class="clear"></div>
    </div>
  </div>`

const fakeCtx = () => {
  const registered = []
  return {
    web: {
      // deliberately NO search() method: the router must never touch the seam
      registerSearchProvider: (provider) => registered.push(provider),
    },
    registered,
    logger: { info: () => {}, debug: () => {} },
  }
}

test('apply registers exactly one provider with the router id', () => {
  const ctx = fakeCtx()
  apply(ctx)
  assert.equal(ctx.registered.length, 1)
  assert.equal(ctx.registered[0].id, 'web-search-router')
  assert.equal(ctx.registered[0].available(), true)
  assert.equal(name, 'dsh-web-search-router')
  assert.deepEqual(inject, ['web', 'credentials', 'settings'])
})

test('registered provider serves web_search end-to-end through the DDG hop', async () => {
  const ctx = fakeCtx()
  apply(ctx, {}, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => undefined },
      text: async () => DDG_PAGE,
    }),
  })
  const provider = ctx.registered[0]
  const result = await provider.search({ query: 'tracer bullet', maxResults: 5 })
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].url, 'https://example.com/wired')
  assert.equal(result.sources[0].title, 'Wired result')
  assert.equal(result.truncated, false)
})

test('exhaustion through the registered provider stays sanitized', async () => {
  const ctx = fakeCtx()
  apply(ctx, {}, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => undefined },
      text: async () => '<html><body>no results here</body></html>',
    }),
  })
  await assert.rejects(ctx.registered[0].search({ query: 'q' }), (error) => {
    assert.equal(error.message, 'no configured search backend succeeded')
    assert.equal(error.code, 'WEB_PROVIDER_ERROR')
    return true
  })
})

test('caller cancellation propagates through the registered provider', async () => {
  const ctx = fakeCtx()
  apply(ctx, {}, {
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('This operation was aborted', 'AbortError')),
        )
      }),
  })
  const controller = new AbortController()
  const pending = ctx.registered[0].search({ query: 'q' }, controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'WEB_ABORTED')
    return true
  })
})

const EXA_JSON = {
  results: [{ url: 'https://example.com/exa-wired', title: 'Exa result', highlights: ['served by exa'] }],
}

test('a resolving credentials seam serves through the exa hop', async () => {
  const ctx = fakeCtx()
  ctx.credentials = {
    resolve: async (reference) => (reference === 'EXA_API_KEY' ? { value: 'wired-exa-key' } : undefined),
  }
  const calls = []
  apply(ctx, {}, {
    fetchImpl: async (url) => {
      calls.push(String(url))
      return {
        ok: true,
        status: 200,
        headers: { get: () => undefined },
        json: async () => EXA_JSON,
      }
    },
  })
  const provider = ctx.registered[0]
  const result = await provider.search({ query: 'keyed tracer', maxResults: 5 })
  assert.deepEqual(calls, ['https://api.exa.ai/search'], 'exa is first in the chain and serves')
  assert.equal(result.sources[0].url, 'https://example.com/exa-wired')
  assert.equal(result.sources[0].title, 'Exa result')
  assert.equal(result.truncated, false)
})

test('an unresolvable credentials seam skips both keyed hops into duckduckgo', async () => {
  const ctx = fakeCtx()
  ctx.credentials = { resolve: async () => undefined }
  const calls = []
  apply(ctx, {}, {
    fetchImpl: async (url) => {
      calls.push(String(url))
      return {
        ok: true,
        status: 200,
        headers: { get: () => undefined },
        text: async () => DDG_PAGE,
      }
    },
  })
  const provider = ctx.registered[0]
  const result = await provider.search({ query: 'q' })
  assert.deepEqual(calls, ['https://html.duckduckgo.com/html/?q=q'], 'keyed hops made zero network attempts')
  assert.equal(result.sources[0].url, 'https://example.com/wired')
  assert.equal(result.sources[0].title, 'Wired result')
})
