# The web-search router reads the calling model at search time from the agent initiator and the session request header

The `ctx.web` seam dispatches `search(request, signal)` with no session or model context, so a
`WebSearchProvider` that wants to route by the active conversation's model (the whole point of
`dsh-web-search-router`) must find the calling model itself. The router resolves it per search
through two public read APIs, in order: `ctx.agents.currentInitiator()` — the dsh-agent service's
process-local causal attribution, documented for host attribution, and active for every tool
execution because the agent loop wraps its whole driver in `withInitiator` — then
`agent.session.requestHeader()?.config` (`{provider, model, …}`), the session log's latest
`request/header` snapshot. A `web_search` tool call only exists inside a turn, after the current
request's header was logged, so at tool time the header names the exact provider and model of the
calling step; it is the same source the web api-proxy trusts for its own selection precedence,
so it tracks mid-session model switches. When no initiator is active (agentless caller), the
router falls back to the most recently created tracked live agent (root `agent/created`
announcement plus scoped disposal cleanup), then to plain fallback-chain order. Documented
fallbacks if the initiator or header APIs disappear upstream: most-recently-active session's
model, then chain order.

## Considered Options

- **Read path (chosen): initiator + request header** — no listeners on any hot path, two
  documented public APIs, per-search resolution (concurrent sessions on different models each
  get their own first hop), and mid-session switches are visible because the header is folded
  per request.
- **Event feed: track `agent/request` / step events into a session→model map** — rejected:
  selection assembly is agent-scoped (needs the per-agent listener pattern anyway), fires
  before tool execution so a map is still needed, and introduces staleness rules the read path
  does not have. (This is the right shape for *writes* — dsh-web-tools' per-session mode
  toggle — but the router only reads.)
- **`agent.options.{provider, model}`** — rejected as primary: set once at construction, so a
  mid-session model switch would route searches to the stale backend. Kept as a fallback tier
  when a session has logged no header yet.
- **Own `AsyncLocalStorage`** — rejected: there is no injection point on the tool-execution
  path where the router could establish a scope; the loop's initiator boundary already is that
  scope.
- **Manual mode switch command** (like free-search's `/free-search-engine`) — rejected: global
  toggle defeats per-session routing (spec story 15) and adds a UI surface the spec keeps out
  of scope.

## Consequences

- Model routing is read at call time and never cached across searches, so a model switch takes
  effect on the very next `web_search`.
- The router keeps a weak registry of live agents (creation announcement → scoped disposal
  cleanup) only to serve the agentless-caller fallback; it holds no per-step state.
- If upstream removes `currentInitiator()` or `requestHeader()`, the router degrades exactly
  as the spec's documented fallback ladder does — most-recent agent, then chain order — and
  the provenance note still names the backend that served.
- Subagents and workflow children get their own sessions and headers, so a child agent's
  searches route by the child's model, which is the honest attribution.
