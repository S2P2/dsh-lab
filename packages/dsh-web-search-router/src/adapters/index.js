/**
 * Backend registry: the canonical default order lives here (spec #8) and each
 * adapter factory is registered on its own line so hop tickets (#90 searxng,
 * #93 codex, #94 zai) append without merge conflicts.
 * @module
 */
import { createExaAdapter } from './exa.js'
import { createTavilyAdapter } from './tavily.js'
import { createDuckduckgoAdapter } from './duckduckgo.js'

/** Stable backend ids in canonical default order: Exa → Tavily → Codex → z.ai → SearXNG → DuckDuckGo. */
export const CANONICAL_ORDER = ['exa', 'tavily', 'codex', 'zai', 'searxng', 'duckduckgo']

/**
 * Default credential resolver for a keyed hop: the DSH credentials service
 * (env/store/`.env` layers) behind a fixed reference. No `process.env`
 * fallback is ever added — the seam already covers it. A missing service or
 * unresolved reference yields undefined, which the adapter turns into a
 * `config` failure; the resolved value goes only into the auth header.
 * @param {object} deps @param {string} reference
 */
function resolveViaCredentials(deps, reference) {
  return async () => {
    const hit = await deps.credentials?.resolve?.(reference)
    return hit?.value
  }
}

/**
 * Build the adapter set. `deps` (fetch impl, credential resolvers, wrapped
 * libraries, clocks) is injected end-to-end for hermetic tests.
 * @param {object} [deps]
 * @returns {object[]} adapters in canonical order (only implemented hops, for now)
 */
export function createDefaultAdapters(deps = {}) {
  const keyed = {
    ...deps,
    resolveExaKey: deps.resolveExaKey ?? resolveViaCredentials(deps, 'EXA_API_KEY'),
    resolveTavilyKey: deps.resolveTavilyKey ?? resolveViaCredentials(deps, 'TAVILY_API_KEY'),
  }
  return [
    createExaAdapter(keyed),
    createTavilyAdapter(keyed),
    createDuckduckgoAdapter(deps), // #90/#93/#94 append adapters here in canonical order
  ]
}
