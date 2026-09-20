import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

/**
 * The loopback state route (ticket #92 host half): GET serves whitelisted
 * card data (health, diagnostics ring, readiness, chain) with no-store;
 * other methods 405. No secrets — readiness comes from credential
 * `describe` facts (configured booleans), never values.
 */

function fakeCtx({ describe } = {}) {
  const ctx = {
    web: { registerSearchProvider: () => {} },
    credentials: { resolve: async () => undefined, ...(describe ? { describe } : {}) },
    on: () => {},
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
    inject: (names, callback) => {
      if (names.includes('webServer')) {
        ctx.webServerInject = callback
      } else if (names.includes('settings')) {
        callback({ settings: undefined })
      }
    },
  }
  return ctx
}

function capturedRoute() {
  const registered = []
  const webServer = { register: (route) => registered.push(route) }
  const effect = (fn) => fn()
  return { registered, webServer, effect }
}

const fakeRes = () => {
  const res = { statusCode: 0, headers: {}, body: '' }
  res.writeHead = (code, headers = {}) => {
    res.statusCode = code
    res.headers = headers
  }
  res.end = (body = '') => {
    res.body += body
  }
  return res
}

test('apply registers the state route through webServer inject', async () => {
  const describe = async (ref) => ({ configured: ref === 'EXA_API_KEY', source: 'user-env', writable: true })
  const ctx = fakeCtx({ describe })
  const route = capturedRoute()
  ctx.inject = (names, callback) => {
    if (names.includes('webServer')) callback({ webServer: route.webServer, effect: route.effect })
  }
  apply(ctx, {}, {
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => undefined }, text: async () => '' }),
  })
  assert.equal(route.registered.length, 1)
  assert.equal(route.registered[0].path, '/dsh-web-search-router/state')
  assert.equal(route.registered[0].kind, 'exact')

  const res = fakeRes()
  await route.registered[0].handler({ method: 'GET' }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  const payload = JSON.parse(res.body)
  assert.deepEqual(payload.chain, ['exa', 'tavily', 'codex', 'zai', 'searxng', 'duckduckgo'])
  assert.deepEqual(payload.readiness, {
    exa: true,
    tavily: false,
    zai: false,
    searxng: false,
    codex: true,
    duckduckgo: true,
  })
  assert.ok(Array.isArray(payload.health))
  assert.ok(Array.isArray(payload.diagnostics))
  assert.equal(JSON.stringify(payload).includes('value'), false, 'no credential values, only configured booleans')
  assert.equal(typeof payload.generatedAt, 'number')
})

test('non-GET methods get 405 with allow header', async () => {
  const ctx = fakeCtx()
  const route = capturedRoute()
  ctx.inject = (names, callback) => {
    if (names.includes('webServer')) callback({ webServer: route.webServer, effect: route.effect })
  }
  apply(ctx, {}, { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => undefined }, text: async () => '' }) })
  const res = fakeRes()
  await route.registered[0].handler({ method: 'POST' }, res)
  assert.equal(res.statusCode, 405)
  assert.equal(res.headers.allow, 'GET')
})

test('health and diagnostics flow from the router into the route payload', async () => {
  const ctx = fakeCtx()
  const route = capturedRoute()
  ctx.inject = (names, callback) => {
    if (names.includes('webServer')) callback({ webServer: route.webServer, effect: route.effect })
  }
  const router = apply(ctx, {}, {
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    },
  })
  // one exhausted search: every networked hop fails network -> transient cooldowns recorded
  await router.search({ query: 'q' }).catch(() => undefined)
  assert.equal(router.healthSnapshot().length, 4, 'all four networked hops cooled')
  assert.equal(router.diagnosticsSnapshot().length, 1)
  const res = fakeRes()
  await route.registered[0].handler({ method: 'GET' }, res)
  const payload = JSON.parse(res.body)
  assert.ok(payload.health.some((e) => e.id === 'duckduckgo' && e.state === 'cooling'))
  assert.equal(payload.diagnostics.length, 1)
  assert.equal(payload.diagnostics[0].outcome, 'exhausted')
  assert.equal(payload.diagnostics[0].backendAttempts.at(-1).failureClass, 'network')
  assert.equal(JSON.stringify(payload.diagnostics).includes('fetch failed'), false, 'message text never reaches the card')
})

test('missing credentials service degrades readiness to unconfigured, never throws', async () => {
  const ctx = fakeCtx()
  delete ctx.credentials
  const route = capturedRoute()
  ctx.inject = (names, callback) => {
    if (names.includes('webServer')) callback({ webServer: route.webServer, effect: route.effect })
  }
  apply(ctx, {}, { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => undefined }, text: async () => '' }) })
  const res = fakeRes()
  await route.registered[0].handler({ method: 'GET' }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body).readiness.exa, false)
})
