import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCodexBackend, createZaiBackend, createExaBackend, createTavilyBackend, createDdgBackend, createSearxngBackend } from '../src/backends.js'

/** Fake fetch: match on URL prefix, return canned Response-ish, record calls. */
function fakeFetch(routes) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    for (const route of routes) {
      if (String(url).startsWith(route.match)) {
        return route.handle({ url: String(url), init }, calls)
      }
    }
    throw new Error(`fake fetch: no route for ${url}`)
  }
  fn.calls = calls
  return fn
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const SIGNAL = new AbortController().signal

test('codex: posts the standalone-search wire shape and maps the response', async () => {
  const fetchImpl = fakeFetch([
    {
      match: 'https://chatgpt.com/backend-api/codex/alpha/search',
      handle: ({ init }) =>
        jsonResponse(200, {
          output: 'synthesized answer',
          results: [
            { type: 'text_result', url: 'https://a/1', title: 'A', snippet: 'sa' },
            { type: 'other', url: 'ignore-me' },
            { type: 'text_result', url: 'https://a/1' },
          ],
        }),
    },
  ])
  const backend = createCodexBackend({
    getAuth: async () => ({ access: 'jwt-token', accountId: 'acct-1' }),
    model: 'gpt-5.6-sol',
    fetchImpl,
  })
  assert.deepEqual(await backend.availability(), { ok: true })
  const out = await backend.search({ query: 'what is dsh', maxResults: 5 }, SIGNAL)
  const [call] = fetchImpl.calls
  assert.equal(call.url, 'https://chatgpt.com/backend-api/codex/alpha/search')
  assert.equal(call.init.headers.authorization, 'Bearer jwt-token')
  assert.equal(call.init.headers['chatgpt-account-id'], 'acct-1')
  const body = JSON.parse(call.init.body)
  assert.equal(body.model, 'gpt-5.6-sol')
  assert.deepEqual(body.commands, { search_query: [{ q: 'what is dsh' }] })
  assert.equal(body.input[0].content[0].text, 'what is dsh')
  assert.equal(out.content, 'synthesized answer')
  assert.deepEqual(
    out.sources.map((s) => s.url),
    ['https://a/1'],
  )
  assert.equal(out.sources[0].title, 'A')
})

test('codex: signed out reports unavailable without a network call', async () => {
  const backend = createCodexBackend({
    getAuth: async () => undefined,
    hasCredential: async () => false,
    model: 'gpt-5.6-sol',
    fetchImpl: fakeFetch([]),
  })
  const availability = await backend.availability()
  assert.equal(availability.ok, false)
  assert.match(availability.reason, /signed out/)
})

test('codex: 401 throws with status for chain rotation', async () => {
  const fetchImpl = fakeFetch([
    { match: 'https://chatgpt.com/backend-api/codex/alpha/search', handle: () => jsonResponse(401, { error: 'expired' }) },
  ])
  const backend = createCodexBackend({
    getAuth: async () => ({ access: 'jwt', accountId: 'a' }),
    model: 'm',
    fetchImpl,
  })
  await assert.rejects(backend.search({ query: 'q' }, SIGNAL), (error) => error.status === 401)
})

test('zai: posts the documented REST shape and maps search_result', async () => {
  const fetchImpl = fakeFetch([
    {
      match: 'https://api.z.ai/api/paas/v4/web_search',
      handle: ({ init }) => {
        if (init.headers.authorization !== 'Bearer zai-key') return jsonResponse(401, { code: 401, message: 'bad key' })
        return jsonResponse(200, {
          id: 't1',
          created: 1,
          search_result: [
            { title: 'T', content: 'snippet text', link: 'https://z/1', publish_date: '2026-08-01' },
          ],
        })
      },
    },
  ])
  const backend = createZaiBackend({ resolveKey: async () => 'zai-key', fetchImpl })
  assert.deepEqual(await backend.availability(), { ok: true })
  const out = await backend.search({ query: 'q', maxResults: 3 }, SIGNAL)
  const [call] = fetchImpl.calls
  const body = JSON.parse(call.init.body)
  assert.equal(body.search_engine, 'search-prime')
  assert.equal(body.search_query, 'q')
  assert.equal(body.count, 3)
  assert.deepEqual(out.sources, [{ url: 'https://z/1', title: 'T', snippet: 'snippet text', publishedAt: '2026-08-01' }])
})

test('zai: missing key is unavailable with the env name in the reason', async () => {
  const backend = createZaiBackend({ resolveKey: async () => undefined, fetchImpl: fakeFetch([]) })
  const availability = await backend.availability()
  assert.equal(availability.ok, false)
  assert.match(availability.reason, /ZAI_API_KEY/)
})

test('zai: error envelope throws with the API status', async () => {
  const fetchImpl = fakeFetch([
    { match: 'https://api.z.ai/api/paas/v4/web_search', handle: () => jsonResponse(429, { code: 429, message: 'rate' }) },
  ])
  const backend = createZaiBackend({ resolveKey: async () => 'k', fetchImpl })
  await assert.rejects(backend.search({ query: 'q' }, SIGNAL), (error) => error.status === 429)
})

test('exa: posts the search body and maps highlights to snippets', async () => {
  const fetchImpl = fakeFetch([
    {
      match: 'https://api.exa.ai/search',
      handle: () =>
        jsonResponse(200, {
          results: [
            { url: 'https://e/1', title: 'E1', publishedDate: '2026-01-01', highlights: ['first highlight', 'second'] },
            { url: 'https://e/2', highlights: [] },
          ],
        }),
    },
  ])
  const backend = createExaBackend({ resolveKey: async () => 'exa-key', fetchImpl })
  const out = await backend.search({ query: 'q', maxResults: 2 }, SIGNAL)
  const [call] = fetchImpl.calls
  assert.equal(call.init.headers.authorization, 'Bearer exa-key')
  const body = JSON.parse(call.init.body)
  assert.equal(body.numResults, 2)
  assert.deepEqual(out.sources, [{ url: 'https://e/1', title: 'E1', snippet: 'first highlight', publishedAt: '2026-01-01' }])
})

test('tavily: posts max_results and maps results', async () => {
  const fetchImpl = fakeFetch([
    {
      match: 'https://api.tavily.com/search',
      handle: () => jsonResponse(200, { results: [{ url: 'https://t/1', title: 'T1', content: 'content snippet' }] }),
    },
  ])
  const backend = createTavilyBackend({ resolveKey: async () => 'tv-key', fetchImpl })
  const out = await backend.search({ query: 'q', maxResults: 7 }, SIGNAL)
  const [call] = fetchImpl.calls
  assert.equal(call.init.headers.authorization, 'Bearer tv-key')
  const body = JSON.parse(call.init.body)
  assert.equal(body.max_results, 7)
  assert.deepEqual(out.sources, [{ url: 'https://t/1', title: 'T1', snippet: 'content snippet' }])
})

test('ddg: scrapes the html endpoint and decodes redirect links', async () => {
  const html = [
    '<div class="result results_links results_links_deep web-result">',
    '  <div class="links_main links_deep result__body">',
    '    <div class="result__extras">',
    '      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freal%2F1">Title &amp; one</a>',
    '      <a class="result__snippet" href="#">snippet <b>text</b></a>',
    '    </div>',
    '  </div>',
    '</div>',
    '<div class="result results_links results_links_deep web-result">',
    '  <div class="links_main links_deep result__body">',
    '    <div class="result__extras">',
    '      <a class="result__a" href="https://direct/2">Direct</a>',
    '      <a class="result__snippet">plain snippet</a>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n')
  const fetchImpl = fakeFetch([
    { match: 'https://html.duckduckgo.com/html/', handle: () => ({ ok: true, status: 200, text: async () => html }) },
  ])
  const backend = createDdgBackend({ fetchImpl })
  assert.deepEqual(await backend.availability(), { ok: true })
  const out = await backend.search({ query: 'q' }, SIGNAL)
  const [call] = fetchImpl.calls
  assert.ok(call.url.includes('q=q'), 'query in URL')
  assert.ok(call.init.headers['user-agent'].length > 0)
  assert.deepEqual(out.sources, [
    { url: 'https://real/1', title: 'Title & one', snippet: 'snippet text' },
    { url: 'https://direct/2', title: 'Direct', snippet: 'plain snippet' },
  ])
})

test('ddg: anti-bot challenge page is a rate-limit failure', async () => {
  const fetchImpl = fakeFetch([
    { match: 'https://html.duckduckgo.com/html/', handle: () => ({ ok: false, status: 202, text: async () => 'anomaly detected' }) },
  ])
  const backend = createDdgBackend({ fetchImpl })
  await assert.rejects(backend.search({ query: 'q' }, SIGNAL), (error) => /rate-limited|anti-bot/.test(error.message))
})

test('searxng: fails over instances and maps json results', async () => {
  const fetchImpl = fakeFetch([
    { match: 'https://s1/search', handle: () => jsonResponse(502, {}) },
    {
      match: 'https://s2/search',
      handle: ({ url }) => {
        assert.ok(url.includes('format=json'))
        return jsonResponse(200, { results: [{ url: 'https://x/1', title: 'X', content: 'c' }] })
      },
    },
  ])
  const backend = createSearxngBackend({ instances: ['https://s1', 'https://s2'], fetchImpl })
  const out = await backend.search({ query: 'q' }, SIGNAL)
  assert.deepEqual(out.sources, [{ url: 'https://x/1', title: 'X', snippet: 'c' }])
})

test('searxng: no reachable instance reports exhausted instances', async () => {
  const fetchImpl = fakeFetch([
    { match: 'https://s1/search', handle: () => jsonResponse(500, {}) },
  ])
  const backend = createSearxngBackend({ instances: ['https://s1'], fetchImpl })
  await assert.rejects(backend.search({ query: 'q' }, SIGNAL), /no instance succeeded/)
})

test('keyed backends resolve their key per search, never cache it', async () => {
  let key = 'k1'
  const fetchImpl = fakeFetch([
    { match: 'https://api.exa.ai/search', handle: () => jsonResponse(200, { results: [] }) },
  ])
  const backend = createExaBackend({ resolveKey: async () => key, fetchImpl })
  await backend.search({ query: 'q' }, SIGNAL)
  key = 'k2'
  await backend.search({ query: 'q' }, SIGNAL)
  assert.equal(fetchImpl.calls[1].init.headers.authorization, 'Bearer k2')
})
