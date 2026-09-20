import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDuckduckgoAdapter, parseDdgHtml, extractDdgUrl } from '../src/adapters/duckduckgo.js'
import { AdapterError, AdapterAbortError } from '../src/errors.js'

/** One DDG result block shaped like html.duckduckgo.com/html/ markup. */
function resultBlock(href, title, snippet) {
  return `
      <div class="result results_links results_links_deep web-result">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="${href}">${title}</a>
          </h2>
          <a class="result__snippet" href="#">${snippet}</a>
          <div class="clear"></div>
        </div>
      </div>`
}

const uddg = (target) => `//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&amp;rut=abc123`

const FIXTURE_HTML = [
  resultBlock(uddg('https://example.com/first'), 'First &amp; best', 'Snippet <b>one</b>'),
  resultBlock(uddg('https://example.com/first'), 'Duplicate of first', 'Should be dropped'),
  resultBlock('https://example.com/direct', 'Direct link', 'No redirect wrapper'),
  resultBlock(uddg('https://example.com/third'), 'Third', 'Snippet three'),
].join('')

const htmlResponse = (html, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] },
  text: async () => html,
})

test('extractDdgUrl resolves uddg wrappers and tolerates plain hrefs', () => {
  assert.equal(extractDdgUrl(uddg('https://a.example/x?a=1&b=2')), 'https://a.example/x?a=1&b=2')
  assert.equal(extractDdgUrl('https://plain.example/y'), 'https://plain.example/y')
  assert.equal(extractDdgUrl('javascript:alert(1)'), undefined)
  assert.equal(extractDdgUrl(undefined), undefined)
})

test('parseDdgHtml extracts ordered sources with stripped titles/snippets', () => {
  const sources = parseDdgHtml(FIXTURE_HTML)
  assert.equal(sources.length, 4, 'parse is pre-dedup; normalize dedups')
  assert.equal(sources[0].url, 'https://example.com/first')
  assert.equal(sources[0].title, 'First & best')
  assert.equal(sources[0].snippet, 'Snippet one')
})

test('adapter serves through the router normalization path', async () => {
  const calls = []
  const adapter = createDuckduckgoAdapter({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), signal: init?.signal })
      return htmlResponse(FIXTURE_HTML)
    },
  })
  const result = await adapter.search({ query: 'hello world', maxResults: 2 }, new AbortController().signal)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://html.duckduckgo.com/html/?q=hello+world')
  // dedup drops the duplicate first URL, then maxResults truncates
  assert.deepEqual(
    result.sources.map((s) => s.url),
    ['https://example.com/first', 'https://example.com/direct'],
  )
  assert.equal(result.truncated, true)
})

test('anti-bot challenge responses are rate_limit, not empty', async () => {
  for (const response of [
    htmlResponse('<html><body> If this persists, please let us know </body></html>', { status: 202 }),
    htmlResponse('<html><body>Anomaly detected — unusual traffic from your network</body></html>'),
  ]) {
    const adapter = createDuckduckgoAdapter({ fetchImpl: async () => response })
    await assert.rejects(adapter.search({ query: 'q' }, new AbortController().signal), (error) => {
      assert.ok(error instanceof AdapterError)
      assert.equal(error.failureClass, 'rate_limit')
      return true
    })
  }
})

test('HTTP 429 surfaces structured retryAfterMs from Retry-After', async () => {
  const adapter = createDuckduckgoAdapter({
    fetchImpl: async () => htmlResponse('throttled', { status: 429, headers: { 'retry-after': '30' } }),
  })
  await assert.rejects(adapter.search({ query: 'q' }, new AbortController().signal), (error) => {
    assert.equal(error.failureClass, 'rate_limit')
    assert.equal(error.retryAfterMs, 30_000)
    return true
  })
})

test('HTTP 5xx maps to upstream; 401/403 map to auth', async () => {
  for (const [status, failureClass] of [[500, 'upstream'], [503, 'upstream'], [403, 'auth']]) {
    const adapter = createDuckduckgoAdapter({ fetchImpl: async () => htmlResponse('', { status }) })
    await assert.rejects(adapter.search({ query: 'q' }, new AbortController().signal), (error) => {
      assert.equal(error.failureClass, failureClass)
      return true
    })
  }
})

test('zero-result page maps to empty', async () => {
  const adapter = createDuckduckgoAdapter({
    fetchImpl: async () => htmlResponse('<html><body><div class="links">no results</div></body></html>'),
  })
  await assert.rejects(adapter.search({ query: 'q' }, new AbortController().signal), (error) => {
    assert.equal(error.failureClass, 'empty')
    return true
  })
})

test('network TypeError maps to retryable network; aborts pass through unclassified', async () => {
  const adapter = createDuckduckgoAdapter({
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    },
  })
  await assert.rejects(adapter.search({ query: 'q' }, new AbortController().signal), (error) => {
    assert.equal(error.failureClass, 'network')
    assert.equal(error.retryable, true)
    return true
  })
  const aborting = createDuckduckgoAdapter({
    fetchImpl: async (url, init) => {
      throw new DOMException('This operation was aborted', 'AbortError')
    },
  })
  await assert.rejects(aborting.search({ query: 'q' }, new AbortController().signal), (error) => {
    assert.ok(error instanceof AdapterAbortError, 'walk classifies aborts, not the adapter')
    return true
  })
})
