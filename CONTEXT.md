# dsh-lab

Experimental DeepSeek Harness (DSH) plugin lab: one package per plugin. This context covers the shared vocabulary of the plugins built here — currently quota visibility (`dsh-quota-bar`), grilling cards (`dsh-grilling-card`), and web search routing (`dsh-web-search-router`).

## Language

### Providers & plans

**Provider**:
An upstream service whose quota the lab renders. Current: GLM Coding Plan and OpenAI Codex.
_Avoid_: vendor, backend, source (overloaded).

**Coding Plan**:
A subscription that grants model access through quota windows instead of a prepaid balance.
_Avoid_: subscription (too broad), pro plan (a tier name).

**Credits**:
GLM's single shared plan accounting unit across models, MCP calls, and tools (legacy plans used prompts instead).
_Avoid_: tokens (the raw LLM unit; credits are weighted by model multipliers), prompts (legacy term).

**Codex Credits**:
Codex's prepaid overage balance, reported with an approximate remaining-message range. Distinct from GLM Credits despite the shared word.
_Avoid_: balance alone (ambiguous with paygo wallet balance).

### Windows

**Window**:
A quota period a plan enforces. GLM: the 5-hour window and the weekly window; Codex: its own 5h/weekly equivalents once confirmed.
_Avoid_: budget (reserved for a user-set limit), period, cycle.

**5-Hour Window**:
A rolling window that resets five hours after consumption begins — not a fixed clock alignment.
_Avoid_: session window (it spans many DSH sessions), hourly quota.

**Weekly Window**:
The plan window that resets on a 7-day cadence from purchase. Its reset may fall before an open 5-hour window's; classify windows by provider field, never by reset-time order.

**Reset Time**:
The instant a window's consumed quota is released back, reported by the provider.

**Tools Budget**:
GLM's third quota lane — the `TIME_LIMIT` window covering MCP-tool spend, shown with the 🔧 marker.
_Avoid_: MCP quota, monthly cap (a Codex concept).

**Monthly Cap**:
Codex's calendar-month spend ceiling, beyond its 5-hour and weekly windows. GLM has no equivalent.
_Avoid_: tools budget, weekly window.

### The widget

**Quota Bar**:
The always-visible indicator strip this plugin renders above the conversation composer, showing window consumption for the active providers.
_Avoid_: status line (pi heritage term), capsule, ring, floating card (other plugins' forms).

**Reading**:
A normalized snapshot of one provider's window states at a point in time, fetched from the provider's quota endpoint.
_Avoid_: measurement (suggests local metering), usage (a field within a reading).

### Grilling

**Grilling Card**:
The structured question card a grilling round is answered in: full round overview, one focused editor, frontier meter.
_Avoid_: form, questionnaire, elicitation panel.

**Round**:
One batch of frontier questions asked together; answering it settles decisions and moves the frontier.
_Avoid_: batch, page (the generic pager's unit).

**Frontier**:
The set of decisions whose prerequisites are settled — the questions askable now. The frontier meter shows rounds elapsed versus estimated and how many decisions remain open.
_Avoid_: backlog, queue.

**Recommendation**:
The agent's proposed answer to a question: a starred option, or a prose Draft for narrative questions. Every question carries one.
_Avoid_: suggestion, default, preferred answer.

**Draft**:
The agent's proposed prose answer to a narrative question, accepted by agreeing or rejected by disagreeing with a comment.
_Avoid_: prefill, autocompletion.

**Comment**:
Optional free text attached to any answer; required when disagreeing with a Draft.
_Avoid_: note, caveat, custom answer (a wire-level term).

**Recorded Round**:
The read-only rendering of a settled round kept in the conversation transcript for review: questions, options, recommendations, and answers in one flat view.
_Avoid_: receipt, history block, tool result.

### Web search routing

**Router**:
The single `WebSearchProvider` (`dsh-web-search-router`) registered on the `ctx.web` seam that decides, per search, which Backend serves it. Owns its whole chain in-package; never delegates to another provider (the seam has no provider-to-provider calls).
_Avoid_: proxy, dispatcher, aggregator.

**First Hop**:
The Backend the attempt order starts with, matched by longest provider-id prefix from the calling session's model (`openai-codex/*` → codex, `zai/*` → zai). Unmatched models start at the Fallback Chain.
_Avoid_: primary backend, preferred engine.

**Fallback Chain**:
The ordered Backend ids attempted after (or instead of) the First Hop: keyed engines first (exa, tavily), free keyless engines last (ddg, searxng). Configured on the plugin row, not coded.
_Avoid_: pool, engine list, priority list.

**Backend**:
One wire implementation inside the Router: codex, zai, exa, tavily, ddg, searxng. Reports a cheap local `availability()` (key/credential presence — never a network call) and one `search()`; wire failures carry an HTTP status and optional cooldown.
_Avoid_: engine (free-search vocabulary), provider (reserved for LLM providers above).

**Provenance Note**:
The line the Router appends to every result's content naming the Backend that served and every skipped or failed hop, so citations are honest: `Note: served by zai; failed codex (HTTP 429).`
_Avoid_: attribution footer, engine note.
