/**
 * Backend registry: the canonical default order lives here (spec #8) and each
 * adapter factory is registered on its own line so hop tickets (#89 exa/tavily,
 * #90 searxng, #93 codex, #94 zai) append without merge conflicts.
 * @module
 */
import { createDuckduckgoAdapter } from './duckduckgo.js'
import { createZaiAdapter } from './zai.js'

/** Stable backend ids in canonical default order: Exa → Tavily → Codex → z.ai → SearXNG → DuckDuckGo. */
export const CANONICAL_ORDER = ['exa', 'tavily', 'codex', 'zai', 'searxng', 'duckduckgo']

/**
 * Build the adapter set. `deps` (fetch impl, credential resolvers, wrapped
 * libraries, clocks) is injected end-to-end for hermetic tests.
 * @param {object} [deps]
 * @returns {object[]} adapters in canonical order (only implemented hops, for now)
 */
export function createDefaultAdapters(deps = {}) {
  return [
    createZaiAdapter(deps),
    createDuckduckgoAdapter(deps), // #89/#90/#93 append adapters here in canonical order
  ]
}
