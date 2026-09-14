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
 * Settings (ticket #91): when the settings service is present, the
 * plugin-owned `web-search-router` namespace is installed via
 * `settings.installSection` (owner = this plugin's ctx); the resolved value
 * is snapshotted once per search, so settings changes apply to the NEXT
 * search. Without the service the router runs on canonical defaults.
 *
 * Zero DSH imports anywhere in the package (error codes ride the seam's
 * open-string `code` convention; the settings schema is built from a lazily
 * imported schemastery), so the full test suite is hermetic.
 * @module
 */
import { SearchRouter, ROUTER_PROVIDER_ID } from './router.js'
import { createDefaultAdapters } from './adapters/index.js'
import { createSettingsHost } from './settings.js'

export const name = 'dsh-web-search-router'

/** Seam service keys. */
export const inject = ['web', 'credentials', 'settings']

/**
 * Cordis apply. `overrides` exists for hermetic wiring tests (fetch impl,
 * clock, scheduler, credential injection, settings installation); production
 * callers omit it. Override entries win over the ctx-provided services.
 * @param {object} ctx @param {object} [_config] composition entry (settings base layer)
 * @param {object} [overrides]
 */
export function apply(ctx, _config = {}, overrides = {}) {
  let settingsHost
  const router = new SearchRouter({
    adapters: createDefaultAdapters({ credentials: ctx?.credentials, ...overrides }),
    // Snapshot per search; the settings host may not be installed yet (async
    // schema import) — undefined snapshot ⇒ constructor defaults.
    resolveConfiguration: overrides.resolveConfiguration ?? (() => settingsHost?.snapshot()),
    ...(overrides.attemptTimeoutMs !== undefined ? { attemptTimeoutMs: overrides.attemptTimeoutMs } : {}),
    ...(overrides.overallTimeoutMs !== undefined ? { overallTimeoutMs: overrides.overallTimeoutMs } : {}),
    ...(overrides.retry !== undefined ? { retry: overrides.retry } : {}),
    ...(overrides.schedule !== undefined ? { schedule: overrides.schedule } : {}),
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
    ...(overrides.health !== undefined ? { health: overrides.health } : {}),
    ...(overrides.diagnostics !== undefined ? { diagnostics: overrides.diagnostics } : {}),
    ...(ctx?.logger !== undefined ? { logger: ctx.logger } : {}),
  })
  ctx.web.registerSearchProvider({
    id: ROUTER_PROVIDER_ID,
    available: () => router.available(),
    search: (request, signal) => router.search(request, signal),
  })

  // Normal user credential edits surface as `credentials/reference-updated`
  // (per-reference event on the credential service, fanned out onto ctx) and
  // clear the affected backend's health so the next search re-attempts it.
  // Ambient process-env changes are NOT emitted by DSH and need a restart.
  if (overrides.onCredentialReferenceUpdated !== undefined) {
    overrides.onCredentialReferenceUpdated((reference) => router.noteCredentialUpdated(reference))
  } else if (typeof ctx?.on === 'function') {
    try {
      ctx.on('credentials/reference-updated', (reference) => router.noteCredentialUpdated(reference))
    } catch (error) {
      ctx.logger?.warn?.('dsh-web-search-router: credential event subscription failed: %s', error?.message)
    }
  }

  const host = createSettingsHost({
    entry: _config,
    importSchema: overrides.importSchema,
    ...(overrides.buildSettingsSchema !== undefined ? { buildSchema: overrides.buildSettingsSchema } : {}),
    // Settings changes clear affected backend health (#88 subscribes its
    // store through this hook) and never mutate an in-flight search.
    onEffectiveChange: () => router.noteSettingsChanged?.(),
    logger: ctx?.logger,
  })
  const installSettings = (settingsService) => (ns, schema, entry, hooks) =>
    settingsService.installSection(ctx, ns, schema, entry, hooks)
  if (overrides.settingsService !== undefined) {
    settingsHost = host
    void host.install(installSettings(overrides.settingsService))
  } else if (typeof ctx?.inject === 'function') {
    ctx.inject(['settings'], (settingsCtx) => {
      settingsHost = host
      void host.install(installSettings(settingsCtx?.settings))
    })
  }

  ctx.logger?.info?.(
    'dsh-web-search-router: registered as search provider "%s" (%d backend(s) in chain)',
    ROUTER_PROVIDER_ID,
    router.chainSize(),
  )
  return router
}
