# The web-search router reads the calling model at search time from the session request header, with an activity-ordered agent fallback

The `ctx.web` seam dispatches `search(request, signal)` with no session or model context, so a
`WebSearchProvider` that wants to route by the active conversation's model (the whole point of
`dsh-web-search-router`) must find the calling model itself. The router resolves it per search:
first `ctx.agents.currentInitiator()` — the dsh-agent service's process-local causal attribution —
then, when no initiator boundary is active, the MOST RECENTLY ACTIVE tracked live agent; the model
itself comes from `agent.session.requestHeader()?.config` (`{provider, model, …}`), the session
log's latest `request/header` snapshot. A `web_search` tool call only exists inside a turn, after
the current request's header was logged, so at tool time the header names the exact provider and
model of the calling step; it is the same source the web api-proxy trusts for its own selection
precedence, so it tracks mid-session model switches. Live dogfooding (2026-08-23) showed the web
tool path does NOT run inside a populated initiator boundary — a Codex-model session's searches
fell through to the fallback — so the fallback tier is load-bearing, not decoration: activity is
tracked with scoped `agent/pre-step` listeners registered inside the root-visible `agent/created`
announcement (the dsh-web-tools deploy pattern), ordered by a monotonic tick (wall-clock
millisecond ties would let a same-ms session creation beat a same-ms step of the older session),
and cleaned up with the agent's scope. Final ladder: initiator → request header → creation-time
agent options → most-recently-active tracked agent → undefined (plain fallback-chain order).

## Considered Options

- **Read path (chosen): initiator/request-header reads + activity-ordered tracked agents** — the
  header remains the model source on every tier (no staleness map of models, only of recency),
  and per-search resolution keeps concurrent sessions on different models on their own first
  hops; the activity listeners carry no payload, only a timestamp.
- **Event feed: track `agent/request` selections into a session→model map** — rejected: the
  header already records exactly that, per request, durably; a second map could only disagree
  with it.
- **`agent.options.{provider, model}`** — rejected as primary: set once at construction, so a
  mid-session model switch would route searches to the stale backend. Kept as a fallback tier
  when a session has logged no header yet.
- **Most-recently-CREATED fallback** — rejected after live dogfooding: creation order picked a
  newer, idle GLM session over the older Codex session whose tool call triggered the search —
  the exact failure the spec's "most-recently-active" wording exists to prevent.
- **Own `AsyncLocalStorage`** — rejected: there is no injection point on the tool-execution
  path where the router could establish a scope; the loop's initiator boundary already is that
  scope (where it is populated).
- **Manual mode switch command** (like free-search's `/free-search-engine`) — rejected: global
  toggle defeats per-session routing (spec story 15) and adds a UI surface the spec keeps out
  of scope.

## Consequences

- Model routing is read at call time and never cached across searches, so a model switch takes
  effect on the very next `web_search`; the provenance note names the routed model
  (`served by codex (routed by openai-codex/gpt-5.6-luna)`), making mis-routing self-evident.
- The router keeps a registry of live agents (creation announcement → scoped listeners +
  disposal cleanup) serving only the agentless-caller tier; it holds no per-step state beyond a
  monotonic activity tick.
- The activity tier is exact for the common case (the stepping session is by definition the
  most recent activity); two sessions stepping in the same tick resolve to the later-tracked
  one, an accepted approximation upstream of a caller-attributed seam.
- If upstream populates `currentInitiator()` across the web tool path (or removes it entirely),
  behavior only gets more precise or degrades to the same ladder — and the provenance note
  still names the backend and model that served.
- Subagents and workflow children get their own sessions and headers, so a child agent's
  searches route by the child's model, which is the honest attribution.
