/**
 * dsh-web-search-router — model-conditional web search routing with a fallback chain.
 *
 * Pure routing core: no DSH imports, no network code. The host entry
 * (src/index.js) constructs this provider with real backends (src/backends.js)
 * and a model-context resolver (src/model-context.js); tests construct it with
 * fakes. The only public surface is the `ctx.web` WebSearchProvider interface.
 * @module
 */

/** Router provider id, selected by a profile's `web.searchProvider` pin. */
export const ROUTER_PROVIDER_ID = 'web-search-router'

/**
 * Plan the attempt order for one search: the model-routed first hop (longest
 * provider-id prefix match wins) followed by the fallback chain, deduplicated.
 * @param {import('./router.js').ModelContext | undefined} model
 * @param {Record<string, string>} modelRoutes - provider prefix → backend id.
 * @param {string[]} fallbackChain - ordered backend ids.
 * @returns {string[]} ordered backend ids to attempt.
 */
export function planAttempts(model, modelRoutes, fallbackChain) {
  const order = []
  if (model?.provider) {
    const prefix = Object.keys(modelRoutes)
      .filter((p) => model.provider === p || model.provider.startsWith(`${p}-`) || model.provider.startsWith(`${p}/`))
      .sort((a, b) => b.length - a.length)[0]
    if (prefix) order.push(modelRoutes[prefix])
  }
  for (const id of fallbackChain) if (!order.includes(id)) order.push(id)
  return order
}

/**
 * The routing WebSearchProvider. Owns its whole backend chain in-package (the
 * `ctx.web` seam has no provider-to-provider calls — a provider invoking
 * `ctx.web.search()` would recurse into itself) and never receives the seam, so
 * the recursion guard is structural.
 */
export class WebSearchRouterProvider {
  /** @param {object} options */
  constructor(options) {
    const { backends, resolveModel, modelRoutes, fallbackChain, now = () => Date.now(), onRouting } = options
    this.id = ROUTER_PROVIDER_ID
    this.#backends = backends
    this.#resolveModel = resolveModel
    this.#modelRoutes = modelRoutes
    this.#fallbackChain = fallbackChain
    this.#now = now
    this.#onRouting = typeof onRouting === 'function' ? onRouting : () => {}
    this.#cooldowns = new Map()
  }

  #backends
  #resolveModel
  #modelRoutes
  #fallbackChain
  #now
  #onRouting
  #cooldowns

  /** Cheap local usability check; must not make network calls. */
  available() {
    return this.#backends.size > 0 && this.#fallbackChain.length > 0
  }

  /** @param {import('./router.js').WebSearchRequest} request @param {AbortSignal} [signal] */
  async search(request, signal) {
    const notes = []
    let lastError
    const model = this.#resolveModel()
    const order = planAttempts(model, this.#modelRoutes, this.#fallbackChain)
    for (const id of order) {
      const backend = this.#backends.get(id)
      if (backend === undefined) {
        notes.push(`skipped ${id} (unknown backend id)`)
        continue
      }
      const cooldownUntil = this.#cooldowns.get(id)
      if (cooldownUntil !== undefined && cooldownUntil > this.#now()) {
        notes.push(`skipped ${id} (rate-limited, cooling down)`)
        continue
      }
      this.#cooldowns.delete(id)
      const availability = await backend.availability()
      if (!availability.ok) {
        notes.push(`skipped ${id} (${availability.reason ?? 'unavailable'})`)
        continue
      }
      try {
        const result = await backend.search(request, signal)
        return this.#withProvenance(result, id, notes, model)
      } catch (error) {
        lastError = error
        const retryAfterMs = typeof error?.retryAfterMs === 'number' ? error.retryAfterMs : undefined
        if (retryAfterMs !== undefined && retryAfterMs > 0) {
          this.#cooldowns.set(id, this.#now() + retryAfterMs)
        }
        notes.push(describeFailure(id, error))
      }
    }
    throw lastError ?? new Error('web-search-router: no usable backend in the chain')
  }

  /**
   * Decorate a served result with provenance. The full note always rides the
   * result as a `provenance` field (survives the seam's spread for direct
   * service callers) and is reported through `onRouting` (host log). It is
   * injected into model-visible `content` ONLY when the chain degraded — the
   * stock web_search tool projects content/sources/truncated to the model, so
   * a clean-serve note would be pure token cost, while a degraded-serve note
   * tells the model to trust the fallback tier's results accordingly.
   */
  #withProvenance(result, id, notes, model) {
    const routed = model === undefined ? '' : ` (routed by ${model.provider}/${model.model})`
    const provenance = `served by ${id}${routed}${notes.length > 0 ? `; ${notes.join('; ')}` : ''}`
    this.#onRouting(provenance)
    if (notes.length === 0) return { ...result, provenance }
    const note = `Note: ${provenance}.`
    const content = [result.content, note].filter((part) => part !== undefined && part !== '').join('\n\n')
    return { ...result, provenance, content }
  }
}

/** One human-readable failure note for a backend that was tried and threw. */
export function describeFailure(id, error) {
  const status = typeof error?.status === 'number' ? ` (HTTP ${error.status})` : ''
  const reason = error?.message ? `: ${String(error.message).slice(0, 200)}` : ''
  return `failed ${id}${status}${reason}`
}
