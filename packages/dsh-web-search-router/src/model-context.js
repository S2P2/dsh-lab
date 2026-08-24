/**
 * dsh-web-search-router — calling-model resolution.
 *
 * Per ADR 0002: the calling agent's own selection is read per search —
 * `ctx.agents.currentInitiator()` when the driver's initiator boundary is
 * active, and the session log's latest `request/header` snapshot as the model
 * source (the same source the web api-proxy trusts, so mid-session model
 * switches are visible). Live dogfooding showed the web tool path does not run
 * inside a populated initiator boundary, so the agentless fallback is the
 * spec's documented one: the MOST RECENTLY ACTIVE tracked live agent. Activity
 * is tracked with scoped `agent/pre-step` listeners registered inside
 * `agent/created` (the dsh-web-tools deploy pattern: root-visible creation
 * announcement, agent-scoped dispatch for per-agent events), so the session
 * that is actually stepping — the one whose tool call triggered the search —
 * wins over merely-newer sessions. Ladder: initiator → header → agent options
 * → most-recently-active tracked agent → undefined (plain chain order).
 * @module
 */

/** Extract `{provider, model}` from one agent, header first, options second. */
function selectionOf(agent) {
  if (agent === undefined || agent === null) return undefined
  try {
    const header = agent.session?.requestHeader?.()?.config
    if (typeof header?.provider === 'string' && typeof header?.model === 'string') {
      return { provider: header.provider, model: header.model }
    }
  } catch {
    /* header reconstruction is best-effort */
  }
  const options = agent.options
  if (typeof options?.provider === 'string' && typeof options?.model === 'string') {
    return { provider: options.provider, model: options.model }
  }
  return undefined
}

/**
 * Build the per-search model resolver for a host context.
 * @param {object} ctx - plugin context (`ctx.agents`, `ctx.on`).
 * @param {object} [options]
 * @param {() => number} [options.now] - activity clock, injectable for tests.
 *   Ordering only (never wall-clock math), so the default is a monotonic
 *   tick: events within one millisecond must still order strictly, or a
 *   same-ms creation would beat a same-ms step of the older session.
 * @returns {() => {provider: string, model: string} | undefined} resolver.
 */
export function createModelResolver(ctx, options = {}) {
  let tick = 0
  const now = options.now ?? (() => (tick += 1))
  /** id → agent (insertion-ordered by creation) and id → last-active ms. */
  const tracked = new Map()
  const lastActive = new Map()
  if (typeof ctx?.on === 'function') {
    ctx.on('agent/created', (payload) => {
      const agent = payload?.agent
      if (agent?.id === undefined) return
      tracked.set(agent.id, agent)
      lastActive.set(agent.id, now())
      // Scoped contributions (the dsh-web-tools pattern): the creation
      // announcement is root-visible; per-agent listeners register on the
      // agent's own scope so dispatch reaches them only for that agent, and
      // everything unwinds with the scope.
      agent.ctx?.effect?.(() => {
        const stopPreStep = agent.ctx?.on?.('agent/pre-step', async (_payload, next) => {
          lastActive.set(agent.id, now())
          return await next()
        })
        return () => {
          stopPreStep?.()
          tracked.delete(agent.id)
          lastActive.delete(agent.id)
        }
      })
    })
  }
  return () => {
    let initiator
    try {
      initiator = ctx?.agents?.currentInitiator?.()
    } catch {
      initiator = undefined
    }
    const direct = selectionOf(initiator)
    if (direct !== undefined) return direct
    // Most recently ACTIVE tracked agent (creation order breaks ties:
    // iteration is insertion-ordered, so >= lets the later-created win).
    let best
    let bestAt = -Infinity
    for (const [id, agent] of tracked) {
      const at = lastActive.get(id) ?? -Infinity
      if (at >= bestAt) {
        best = agent
        bestAt = at
      }
    }
    return best === undefined ? undefined : selectionOf(best)
  }
}
