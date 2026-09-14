/**
 * Plugin-owned settings host (ticket #91): the `web-search-router` namespace
 * on the DSH settings seam — one ordered list of backend records (stable id +
 * enabled), global knobs (attempt/overall timeout, retries per backend), and
 * the SearXNG base-URL slot (#90 consumes it).
 *
 * Pure logic lives here (normalization, effective-config resolution, the
 * host object); the schemastery schema is BUILT by an injected `z` so the
 * package keeps zero static DSH imports and the suite stays hermetic. The
 * host follows the current settings API: `installSection(owner, ns, schema,
 * entry, hooks)` with plain-string namespaces and `setSource`/`onChange`
 * hooks; settings are snapshotted once per search by the router (next-search
 * semantics for mid-request changes).
 * @module
 */
import { CANONICAL_ORDER } from './adapters/index.js'
import { DEFAULT_ATTEMPT_TIMEOUT_MS, DEFAULT_OVERALL_TIMEOUT_MS, MAX_RETRIES_PER_BACKEND } from './policy.js'

/** Plugin-owned settings namespace (plain lowercase-hyphenated string). */
export const SETTINGS_NAMESPACE = 'web-search-router'

/** Default enabled state for every known backend: enabled (unconfigured hops degrade to config-skip at search time). */
const defaultEnabled = () => true

/** The canonical default backend order as settings records. */
export function defaultBackendOrder() {
  return CANONICAL_ORDER.map((id) => ({ id, enabled: defaultEnabled(id) }))
}

/**
 * Normalize a stored backend list against the known backend ids (spec):
 * absent ⇒ defaults; unknown ids ignored with a diagnostic; duplicate ids
 * collapse to the first occurrence; newly known backends are appended with
 * their default enabled state; malformed entries never throw (a stale
 * document must not fail startup). Disabling preserves position; the array
 * order IS the chain order.
 * @param {unknown} stored @param {string[]} [knownIds] @param {{onDiagnostic?: (message: string) => void}} [options]
 * @returns {{id: string, enabled: boolean}[]}
 */
export function normalizeBackendOrder(stored, knownIds = CANONICAL_ORDER, options = {}) {
  const onDiagnostic = options.onDiagnostic
  const diagnose = (message) => {
    try {
      onDiagnostic?.(message)
    } catch {
      /* diagnostics must never break normalization */
    }
  }
  if (!Array.isArray(stored)) return defaultBackendOrder()
  const known = new Set(knownIds)
  const seen = new Set()
  const result = []
  for (const entry of stored) {
    const id = entry?.id
    if (typeof id !== 'string' || id.length === 0) {
      diagnose(`ignoring malformed backend entry: ${JSON.stringify(entry)?.slice(0, 60)}`)
      continue
    }
    if (!known.has(id)) {
      diagnose(`ignoring unknown backend id "${id}"`)
      continue
    }
    if (seen.has(id)) {
      diagnose(`duplicate backend id "${id}" collapsed to first occurrence`)
      continue
    }
    seen.add(id)
    result.push({ id, enabled: entry.enabled === false ? false : true })
  }
  for (const id of knownIds) {
    if (!seen.has(id)) result.push({ id, enabled: defaultEnabled(id) })
  }
  return result
}

/**
 * Resolve the effective router configuration from a settings source value
 * (already schema-resolved by the seam, or anything defensive). Invalid knob
 * values fall back to defaults — a stale document never breaks a search.
 * @param {unknown} source @param {string[]} [knownIds]
 * @returns {{backends: {id: string, enabled: boolean}[], attemptTimeoutMs: number, overallTimeoutMs: number, maxRetries: number, searxngBaseUrl: string}}
 */
export function resolveEffectiveSettings(source, knownIds = CANONICAL_ORDER) {
  const value = source !== null && typeof source === 'object' ? source : {}
  const positiveNumber = (candidate, fallback) =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : fallback
  const nonNegative = (candidate, fallback) =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : fallback
  const baseUrl = typeof value.searxng?.baseUrl === 'string' ? value.searxng.baseUrl.trim() : ''
  return {
    backends: normalizeBackendOrder(value.backends, knownIds),
    attemptTimeoutMs: positiveNumber(value.attemptTimeoutMs, DEFAULT_ATTEMPT_TIMEOUT_MS),
    overallTimeoutMs: positiveNumber(value.overallTimeoutMs, DEFAULT_OVERALL_TIMEOUT_MS),
    maxRetries: nonNegative(value.maxRetriesPerBackend, MAX_RETRIES_PER_BACKEND),
    searxngBaseUrl: baseUrl,
  }
}

/**
 * Build the namespace schema with an INJECTED schemastery `z` (the host
 * import stays lazy; tests inject a stand-in). Shape mirrors
 * {@link resolveEffectiveSettings}.
 * @param {import('@deepseek-ai/schemastery').default} z
 */
export function buildSettingsSchema(z) {
  return z.object({
    backends: z.array(z.object({ id: z.string(), enabled: z.boolean() })).default(defaultBackendOrder()),
    attemptTimeoutMs: z.number().default(DEFAULT_ATTEMPT_TIMEOUT_MS),
    overallTimeoutMs: z.number().default(DEFAULT_OVERALL_TIMEOUT_MS),
    maxRetriesPerBackend: z.number().default(MAX_RETRIES_PER_BACKEND),
    searxng: z.object({ baseUrl: z.string().default('') }).default({ baseUrl: '' }),
  })
}

/**
 * The settings host: owns the installSection wiring and the authoritative
 * source thunk. `snapshot()` is called by the router once per search.
 * @param {object} options
 * @param {unknown} [options.entry] composition entry (base layer)
 * @param {(z: unknown) => unknown} [options.buildSchema] @param {() => Promise<unknown>} [options.importSchema]
 * @param {string[]} [options.knownIds] @param {() => void} [options.onEffectiveChange]
 * @param {{warn?: Function, info?: Function}} [options.logger]
 */
export function createSettingsHost(options) {
  const {
    entry = {},
    buildSchema = buildSettingsSchema,
    importSchema = () => import('@deepseek-ai/schemastery'),
    knownIds = CANONICAL_ORDER,
    onEffectiveChange,
    logger,
  } = options
  let current = () => entry
  const host = {
    /**
     * Install through the seam once the schema module resolves; warn (never
     * throw) on failure — settings must never break registration.
     * @param {(ns: string, schema: unknown, entryValue: unknown, hooks: object) => void} installSection
     */
    async install(installSection) {
      try {
        const imported = await importSchema()
        const z = imported?.default ?? imported
        installSection(SETTINGS_NAMESPACE, buildSchema(z), entry, {
          setSource(source) {
            current = source
          },
          onChange() {
            try {
              onEffectiveChange?.()
            } catch (error) {
              logger?.warn?.('dsh-web-search-router: settings change handler failed: %s', error?.message)
            }
          },
        })
      } catch (error) {
        logger?.warn?.('dsh-web-search-router: settings namespace unavailable (%s); using defaults', error?.message)
      }
    },
    /** Effective configuration for the NEXT search; never throws. */
    snapshot() {
      try {
        return resolveEffectiveSettings(current(), knownIds)
      } catch {
        return resolveEffectiveSettings(undefined, knownIds)
      }
    },
  }
  return host
}
