/**
 * Codex adapter — the subscription hop of the chain (spec #8, ticket #93).
 *
 * Wraps `dsh-codex-connect`'s public exports as a library: its
 * `OpenAICodexCredentialStore` owns the shared OAuth document (the adapter
 * never reads, parses, or prints the document itself — read/refresh happen
 * only through the store API inside the wrapped provider) and its
 * `OpenAICodexSearchProvider` performs the search (constructed from options
 * once per adapter and reused; it is never registered on `ctx.web` and no
 * Cordis apply ever runs). The module resolves through an injected seam and
 * only falls back to a dynamic `import('dsh-codex-connect')` in production,
 * so the hermetic suite never touches the real package.
 *
 * The wrapped provider's failures arrive as plain `WebError`s (open-string
 * `.code`, HTTP status only in the message text): credential-missing and
 * 401/403 → `auth`, `HTTP 429` in the message → `rate_limit` with NO
 * structured retryAfterMs (none exists on this path — the default cooldown
 * policy owns it), other failures → `upstream` with retryable ONLY for the
 * 502/503/504 transport set. The provider also converts every cancellation
 * into its stable `WEB_ABORTED` error; the adapter maps that (and any native
 * abort shape) back to an unclassified `AdapterAbortError` so the router
 * walk — the only party that knows which signal fired — classifies it.
 *
 * Like every adapter it creates no timers: the walk owns the attempt
 * deadline through the passed signal, and the wrapped provider's internal
 * 30 s deadline loses to the earlier walk abort by design.
 *
 * Startup compatibility gate (warn-not-disable): on first construction the
 * adapter evaluates the library's exported `assessCompatibility` ONCE over
 * `deps.compatibilityVersions` and logs a warning for `incompatible` or
 * `unverified` results through `deps.logger`; the backend stays enabled
 * either way. Without supplied versions the check is skipped with a debug
 * log — host package versions are never guessed hermetically. (The ticket
 * also mentioned `isSupportedDshPluginApiVersion`; that export does not
 * exist in the pinned 0.1.0-alpha.4.34, verified against the installed
 * package, so the gate keys on `assessCompatibility` alone.)
 * @module
 */
import { AdapterError, AdapterAbortError } from '../errors.js'
import { isAbortLike } from '../http.js'
import { normalizeResult } from '../normalize.js'

/** Production module resolver: the wrapped library, imported dynamically (never at module scope). */
const importCodexConnectLibrary = () => import('dsh-codex-connect')

/** Statuses the wrapped provider surfaces only through its message text; only these are transport-transient. */
const TRANSIENT_UPSTREAM_STATUSES = new Set([502, 503, 504])

/** Never-throw host logging (mirrors the router's safeLog; emitters are best-effort). */
function safeLog(logger, level, format, ...args) {
  try {
    logger?.[level]?.(format, ...args)
  } catch {
    /* host logging must never break search */
  }
}

/**
 * Translate a wrapped-provider failure into the closed failure vocabulary.
 * The HTTP status lives only in the `WebError` message text on this path, so
 * the class decision reads it from there; messages we emit stay
 * status-only (no upstream text echo, no credential echo).
 * @param {unknown} error @param {string} id @returns {Error}
 */
export function translateCodexFailure(error, id) {
  if (error instanceof AdapterError || error instanceof AdapterAbortError) return error
  // Abort shapes stay unclassified: the walk tells caller-abort (terminal)
  // from attempt-deadline (timeout). The provider rewrites cancellations
  // into its stable WEB_ABORTED WebError, so recognize that code too.
  if (isAbortLike(error) || error?.code === 'WEB_ABORTED') return new AdapterAbortError(error)
  const message = typeof error?.message === 'string' ? error.message : ''
  const statusText = /HTTP (\d{3})/.exec(message)?.[1]
  const status = statusText === undefined ? undefined : Number(statusText)
  if (error?.code === 'WEB_PROVIDER_CREDENTIAL_MISSING' || status === 401 || status === 403) {
    return new AdapterError(
      status === undefined ? `${id}: signed out or missing credential` : `${id}: HTTP ${status}`,
      'auth',
      { cause: error },
    )
  }
  if (status === 429) {
    // No structured Retry-After exists on this path; do not invent one.
    return new AdapterError(`${id}: HTTP 429`, 'rate_limit', { cause: error })
  }
  return new AdapterError(
    status === undefined ? `${id}: search failed` : `${id}: HTTP ${status}`,
    'upstream',
    { cause: error, ...(TRANSIENT_UPSTREAM_STATUSES.has(status) ? { retryable: true } : {}) },
  )
}

/**
 * Startup compatibility gate: evaluate the library's pure compatibility
 * assessment once over supplied versions and WARN (never disable) when the
 * result is `incompatible` or `unverified`.
 * @param {object} codexConnect the wrapped module @param {object} deps
 */
function warnIfIncompatible(codexConnect, deps) {
  if (typeof codexConnect.assessCompatibility !== 'function') return
  const versions = deps.compatibilityVersions
  if (versions === undefined || versions === null) {
    safeLog(
      deps.logger,
      'debug',
      'web-search-router: codex compatibility check skipped: no host versions supplied',
    )
    return
  }
  let report
  try {
    report = codexConnect.assessCompatibility(versions)
  } catch (error) {
    safeLog(
      deps.logger,
      'warn',
      'web-search-router: codex compatibility assessment failed (warn-only): %s',
      error?.message ?? 'unknown error',
    )
    return
  }
  if (report?.status === 'incompatible' || report?.status === 'unverified') {
    safeLog(
      deps.logger,
      'warn',
      'web-search-router: dsh-codex-connect compatibility %s (warn-only: the codex backend stays enabled)',
      report.status,
    )
  }
}

/**
 * Resolve and construct the wrapped runtime once: the module (injected or
 * dynamically imported), the shared credential store, and the search
 * provider. Nothing here touches the network or reads the OAuth document —
 * the store only opens it inside the provider's per-request auth resolution.
 * @param {object} deps
 */
async function startRuntime(deps) {
  const source =
    deps.codexConnect !== undefined && deps.codexConnect !== null
      ? deps.codexConnect // module object or promise
      : (deps.importCodexConnect ?? importCodexConnectLibrary)()
  const codexConnect = await source
  if (codexConnect === null || typeof codexConnect !== 'object') {
    throw new Error('dsh-codex-connect did not export a module object')
  }
  // Default $DSH_HOME path: no explicit filename, no vendored reader.
  const store = deps.credentialStore ?? new codexConnect.OpenAICodexCredentialStore()
  const provider = new codexConnect.OpenAICodexSearchProvider({
    credentials: store,
    resolveRequestId: () =>
      deps.resolveRequestId?.() ?? `dsh-web-search-router-${crypto.randomUUID()}`,
    ...(deps.codexOptions ?? {}),
  })
  warnIfIncompatible(codexConnect, deps)
  return { codexConnect, store, provider }
}

/**
 * Create the Codex adapter.
 * @param {object} [deps]
 * @param {object | Promise<object>} [deps.codexConnect] injected wrapped module (tests)
 * @param {() => Promise<object>} [deps.importCodexConnect] injected module resolver (tests)
 * @param {object} [deps.credentialStore] pre-built credential store; defaults to the wrapped library's own
 * @param {() => string} [deps.resolveRequestId] request-identity source; defaults to a unique router id
 * @param {object} [deps.codexOptions] extra provider options (model, mode, contextSize, maxOutputTokens, …)
 * @param {object} [deps.compatibilityVersions] assessCompatibility input ({node?/nodeVersion?, packages?/packageVersions?})
 * @param {object} [deps.logger] host logger for the warn-not-disable compatibility gate
 */
export function createCodexAdapter(deps = {}) {
  const id = 'codex'
  let runtimePromise
  /** Memoized lazy runtime; an import failure stays cached as a needs-setup state. */
  const resolveRuntime = () => {
    if (runtimePromise === undefined) runtimePromise = startRuntime(deps)
    return runtimePromise
  }
  return {
    id,
    /** Async by design (the walk awaits thenables): the wrapped module may need a dynamic import. */
    async status() {
      try {
        await resolveRuntime()
        return { ok: true, state: 'ready' }
      } catch (error) {
        return {
          ok: false,
          reason: `dsh-codex-connect unavailable: ${error?.message ?? 'unknown error'}`,
        }
      }
    },
    /** @param {{query: string, maxResults?: number}} request @param {AbortSignal} attemptSignal */
    async search(request, attemptSignal) {
      let runtime
      try {
        runtime = await resolveRuntime()
      } catch (error) {
        throw new AdapterError(`${id}: dsh-codex-connect unavailable`, 'config', { cause: error })
      }
      let result
      try {
        result = await runtime.provider.search(request, attemptSignal)
      } catch (error) {
        throw translateCodexFailure(error, id)
      }
      // The provider returns the stock WebSearchResult shape via its own
      // mapper; re-validate through the shared normalizer so the ≥1 usable
      // http(s) source, dedup, and maxResults rules apply like every hop.
      return normalizeResult(result, request.maxResults)
    },
  }
}
