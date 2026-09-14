/**
 * Result normalization shared by every adapter: the router's success
 * threshold and dedup/truncation rules live here so each backend module only
 * maps its wire shape (spec #8: "Result normalization").
 *
 * A backend result succeeds only when at least one usable HTTP(S) source
 * survives; otherwise it is an `empty` failure that falls through. Backend
 * result order is preserved; provider-generated `content` is preserved when
 * present; obvious equivalent URLs are deduplicated conservatively; nothing
 * is reranked, synthesized, or fetched.
 * @module
 */
import { AdapterError } from './errors.js'

/** Return the URL string when it is a usable http(s) URL, else undefined. */
export function usableUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * Conservative equivalence key: scheme/host lowercased, fragment dropped,
 * lone trailing slash dropped. Query strings and paths compare verbatim —
 * near-miss URLs are intentionally kept (spec: "conservative deduplication").
 */
function equivalenceKey(url) {
  const parsed = new URL(url)
  const host = parsed.host.toLowerCase()
  const path = parsed.pathname.length > 1 && parsed.pathname.endsWith('/')
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname
  return `${parsed.protocol}//${host}${path}${parsed.search}`
}

/**
 * Map raw backend sources to stock `WebSearchSource` shape, keeping only
 * usable http(s) URLs, deduplicating obvious equivalents, preserving order.
 * @param {Iterable<{url: unknown, title?: unknown, snippet?: unknown, publishedAt?: unknown}>} rawSources
 * @returns {{url: string, title?: string, snippet?: string, publishedAt?: string}[]}
 */
export function normalizeSources(rawSources) {
  const sources = []
  const seen = new Set()
  for (const raw of rawSources) {
    if (raw === null || typeof raw !== 'object') continue
    const url = usableUrl(raw.url)
    if (url === undefined) continue
    const key = equivalenceKey(new URL(url))
    if (seen.has(key)) continue
    seen.add(key)
    const source = { url }
    if (typeof raw.title === 'string' && raw.title.length > 0) source.title = raw.title
    if (typeof raw.snippet === 'string' && raw.snippet.length > 0) source.snippet = raw.snippet
    if (typeof raw.publishedAt === 'string' && raw.publishedAt.length > 0) source.publishedAt = raw.publishedAt
    sources.push(source)
  }
  return sources
}

/**
 * Normalize one backend response into the stock `WebSearchResult` shape, or
 * throw `empty` when no usable HTTP(S) source survived.
 * @param {{content?: unknown, sources: Iterable<object>}} raw
 * @param {number | undefined} maxResults
 * @returns {{content?: string, sources: object[], truncated: boolean}}
 */
export function normalizeResult(raw, maxResults) {
  const sources = normalizeSources(raw?.sources ?? [])
  if (sources.length === 0) {
    throw new AdapterError('backend response contained no usable http(s) sources', 'empty')
  }
  const capped =
    maxResults !== undefined && sources.length > maxResults
      ? { sources: sources.slice(0, maxResults), truncated: true }
      : { sources, truncated: false }
  const result = { sources: capped.sources, truncated: capped.truncated }
  if (typeof raw?.content === 'string' && raw.content.length > 0) result.content = raw.content
  return result
}
