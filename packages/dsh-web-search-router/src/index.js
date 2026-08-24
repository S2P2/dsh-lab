/**
 * dsh-web-search-router — host entry.
 *
 * Registers one `WebSearchProvider` on the `ctx.web` seam that routes each
 * search by the calling session's model (Codex models → Codex search, GLM →
 * z.ai search) and otherwise walks a keyed-then-free fallback chain, with
 * provenance notes naming the backend that served. Spec of record: S2P2/dsh-lab
 * issue #8; model-detection decision: docs/adr/0002.
 * @module
 */

import z from '@deepseek-ai/schemastery'
import { WebError } from '@deepseek-ai/dsh-web'
import { WebSearchRouterProvider, ROUTER_PROVIDER_ID } from './router.js'
import {
  createCodexBackend,
  createZaiBackend,
  createExaBackend,
  createTavilyBackend,
  createDdgBackend,
  createSearxngBackend,
} from './backends.js'
import { createModelResolver } from './model-context.js'
import { createCodexAuth } from './codex-auth.js'

export const name = 'dsh-web-search-router'

/** The seam service plus the credentials service keys resolve through. */
export const inject = ['web', 'credentials']

export const Config = z.object({
  modelRoutes: z.dict(z.string()).default({ 'openai-codex': 'codex', zai: 'zai' }),
  fallbackChain: z.array(z.string()).default(['exa', 'tavily', 'ddg', 'searxng']),
  codex: z.object({
    model: z.string().default('gpt-5.6-sol'),
    mode: z.string().default('cached'),
    contextSize: z.string().default('medium'),
    maxOutputTokens: z.number().default(10_000),
  }),
  zai: z.object({
    apiKeyEnv: z.string().default('ZAI_API_KEY'),
  }),
  exa: z.object({ apiKeyEnv: z.string().default('EXA_API_KEY') }),
  tavily: z.object({ apiKeyEnv: z.string().default('TAVILY_API_KEY') }),
  searxng: z.object({ instances: z.array(z.string()) }),
  requestTimeoutMs: z.number().default(15_000),
})

/** Resolve a key reference per call: credentials service, then process env. Never cached. */
function keyResolver(ctx, envName) {
  return async () => {
    try {
      const hit = await ctx.credentials.resolve(envName)
      if (hit?.value) return hit.value
    } catch {
      /* fall through to the environment */
    }
    return process.env[envName]
  }
}

export function apply(ctx, config) {
  const timeoutMs = config.requestTimeoutMs
  const codexAuth = createCodexAuth()
  const backends = new Map()
  for (const backend of [
    createCodexBackend({
      getAuth: codexAuth.getAuth,
      hasCredential: codexAuth.hasCredential,
      model: config.codex.model,
      mode: config.codex.mode,
      contextSize: config.codex.contextSize,
      maxOutputTokens: config.codex.maxOutputTokens,
      timeoutMs,
    }),
    createZaiBackend({ resolveKey: keyResolver(ctx, config.zai.apiKeyEnv), timeoutMs }),
    createExaBackend({ resolveKey: keyResolver(ctx, config.exa.apiKeyEnv), timeoutMs }),
    createTavilyBackend({ resolveKey: keyResolver(ctx, config.tavily.apiKeyEnv), timeoutMs }),
    createDdgBackend({ timeoutMs }),
    createSearxngBackend({ instances: config.searxng?.instances ?? [], timeoutMs }),
  ]) {
    backends.set(backend.id, backend)
  }

  const provider = new WebSearchRouterProvider({
    backends,
    resolveModel: createModelResolver(ctx),
    modelRoutes: config.modelRoutes,
    fallbackChain: config.fallbackChain,
    // Provenance lives in the host log + the result's provenance field; the
    // model-visible content gets a note only when the chain degraded (the
    // stock web_search tool projects content/sources/truncated to the model,
    // so a clean-serve note would be pure token cost).
    onRouting: (note) => ctx.logger?.info?.('web-search-router: %s', note),
  })

  ctx.web.registerSearchProvider({
    id: ROUTER_PROVIDER_ID,
    available: () => provider.available(),
    async search(request, signal) {
      try {
        return await provider.search(request, signal)
      } catch (error) {
        if (error instanceof WebError) throw error
        if (signal?.aborted === true) {
          throw new WebError('web-search-router search aborted', 'WEB_ABORTED', { cause: error })
        }
        throw new WebError(`web-search-router: ${error?.message ?? 'search failed'}`, 'WEB_PROVIDER_ERROR', { cause: error })
      }
    },
  })
  ctx.logger?.info?.('dsh-web-search-router: registered (chain %s)', config.fallbackChain.join(' → '))
}
