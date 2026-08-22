# dsh-lab

Experimental DeepSeek Harness (DSH) plugin lab: one package per plugin. This context covers the shared vocabulary of the plugins built here, currently centered on quota visibility (`dsh-quota-bar`).

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
