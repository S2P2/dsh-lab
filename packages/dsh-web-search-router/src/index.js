/**
 * dsh-web-search-router — host entry.
 *
 * Registers one `WebSearchProvider` (id `web-search-router`) on the `ctx.web`
 * seam that walks the package's internal Search Adapters sequentially until
 * the first structurally valid result (spec #8). The router owns its whole
 * backend chain in-package: it never receives or calls the `ctx.web` search
 * seam, so provider-to-provider recursion is structurally impossible. Backend
 * selection is id-based via the profile's `web` composition row
 * (`searchProvider: web-search-router`) — see README.
 *
 * Zero DSH imports anywhere in the package (error codes ride the seam's
 * open-string `code` convention), so the full test suite is hermetic.
 * @module
 */
import { SearchRouter, ROUTER_PROVIDER_ID } from './router.js'
import { createDefaultAdapters } from './adapters/index.js'

export const name = 'dsh-web-search-router'

/** Seam service keys. `settings` joins when its ticket lands. */
export const inject = ['web', 'credentials']

/**
 * Cordis apply. `overrides` exists for hermetic wiring tests (fetch impl,
 * clock, scheduler, credential injection); production callers omit it.
 * Override entries win over the ctx-provided services.
 * @param {object} ctx @param {object} [_config] @param {object} [overrides]
 */
export function apply(ctx, _config = {}, overrides = {}) {
  const router = new SearchRouter({
    adapters: createDefaultAdapters({ credentials: ctx?.credentials, ...overrides }),
    ...(overrides.attemptTimeoutMs !== undefined ? { attemptTimeoutMs: overrides.attemptTimeoutMs } : {}),
    ...(overrides.schedule !== undefined ? { schedule: overrides.schedule } : {}),
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
    ...(ctx?.logger !== undefined ? { logger: ctx.logger } : {}),
  })
  ctx.web.registerSearchProvider({
    id: ROUTER_PROVIDER_ID,
    available: () => router.available(),
    search: (request, signal) => router.search(request, signal),
  })
  ctx.logger?.info?.(
    'dsh-web-search-router: registered as search provider "%s" (%d backend(s) in chain)',
    ROUTER_PROVIDER_ID,
    router.chainSize(),
  )
  return router
}
