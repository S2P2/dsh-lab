/**
 * dsh-web-search-router — calling-model resolution.
 *
 * Per ADR 0002: read, don't listen. The calling agent comes from
 * `ctx.agents.currentInitiator()` (host attribution, active across the whole
 * tool-execution driver), and its model from the session log's latest
 * `request/header` snapshot — the same source the web api-proxy trusts for its
 * own selection, so mid-session model switches are visible. Fallback ladder:
 * creation-time agent options → most recently created tracked live agent →
 * undefined (the router then serves plain chain order).
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
 * @returns {() => {provider: string, model: string} | undefined} resolver.
 */
export function createModelResolver(ctx) {
  /** id → agent, insertion-ordered by creation; used only for the agentless fallback. */
  const tracked = new Map()
  if (typeof ctx?.on === 'function') {
    ctx.on('agent/created', (payload) => {
      const agent = payload?.agent
      if (agent?.id === undefined) return
      tracked.set(agent.id, agent)
      // Scoped disposal cleanup (the dsh-web-tools pattern): the announcement
      // is root-visible, the disposal edge is scope-filtered.
      agent.ctx?.effect?.(() => {
        return () => {
          tracked.delete(agent.id)
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
    for (const agent of [...tracked.values()].reverse()) {
      const fallback = selectionOf(agent)
      if (fallback !== undefined) return fallback
    }
    return undefined
  }
}
