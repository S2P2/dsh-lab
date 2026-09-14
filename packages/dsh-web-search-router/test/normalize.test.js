import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usableUrl, normalizeSources, normalizeResult } from '../src/normalize.js'
import { AdapterError } from '../src/errors.js'

test('usableUrl keeps only http(s) URLs', () => {
  assert.equal(usableUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(usableUrl('http://example.com/a'), 'http://example.com/a')
  assert.equal(usableUrl('ftp://example.com/a'), undefined)
  assert.equal(usableUrl('javascript:alert(1)'), undefined)
  assert.equal(usableUrl('not a url'), undefined)
  assert.equal(usableUrl(''), undefined)
  assert.equal(usableUrl(undefined), undefined)
})

test('normalizeSources deduplicates conservatively and preserves order', () => {
  const sources = normalizeSources([
    { url: 'https://a.example/x', title: 'first' },
    { url: 'https://a.example/x', title: 'exact duplicate' },
    { url: 'https://a.example/x#section', title: 'fragment duplicate' },
    { url: 'https://a.example/x/', title: 'trailing-slash duplicate' },
    { url: 'http://a.example/x', title: 'different scheme kept' },
    { url: 'https://a.example/x?b=1', title: 'different query kept' },
    { url: 'ftp://a.example/x', title: 'non-http dropped' },
    { title: 'missing url dropped' },
  ])
  assert.deepEqual(
    sources.map((s) => s.url),
    ['https://a.example/x', 'http://a.example/x', 'https://a.example/x?b=1'],
  )
  assert.equal(sources[0].title, 'first', 'first occurrence wins')
})

test('normalizeSources maps optional fields only when present', () => {
  const [source] = normalizeSources([
    { url: 'https://a.example/x', title: 't', snippet: 's', publishedAt: '2026-09-13' },
  ])
  assert.deepEqual(source, { url: 'https://a.example/x', title: 't', snippet: 's', publishedAt: '2026-09-13' })
  const [bare] = normalizeSources([{ url: 'https://a.example/y', title: '', snippet: undefined }])
  assert.deepEqual(bare, { url: 'https://a.example/y' })
})

test('normalizeResult throws empty when no usable source survives', () => {
  assert.throws(() => normalizeResult({ sources: [{ url: 'ftp://a/x' }] }, 5), (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.failureClass, 'empty')
    return true
  })
  assert.throws(() => normalizeResult({ sources: [] }, 5), (error) => error.failureClass === 'empty')
})

test('normalizeResult honors maxResults and sets truncated', () => {
  const result = normalizeResult(
    { sources: [{ url: 'https://a/1' }, { url: 'https://a/2' }, { url: 'https://a/3' }] },
    2,
  )
  assert.equal(result.sources.length, 2)
  assert.equal(result.truncated, true)
  const exact = normalizeResult({ sources: [{ url: 'https://a/1' }, { url: 'https://a/2' }] }, 2)
  assert.equal(exact.truncated, false)
})

test('normalizeResult preserves provider content when non-empty', () => {
  const withContent = normalizeResult({ content: 'synthesized answer', sources: [{ url: 'https://a/1' }] }, 5)
  assert.equal(withContent.content, 'synthesized answer')
  const withoutContent = normalizeResult({ content: '', sources: [{ url: 'https://a/1' }] }, 5)
  assert.equal('content' in withoutContent, false)
  const nonString = normalizeResult({ content: 42, sources: [{ url: 'https://a/1' }] }, 5)
  assert.equal('content' in nonString, false)
})
