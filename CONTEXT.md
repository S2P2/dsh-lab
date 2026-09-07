# dsh-lab

Experimental DeepSeek Harness (DSH) plugin lab: one package per plugin. This context covers the shared vocabulary of the plugins built here — currently quota visibility (`dsh-quota-bar`) and grilling cards (`dsh-grilling-card`).

## Language

### Agent harness research

**Capability**:
A user- or agent-visible thing an agent harness enables, independent of the mechanism used to implement it. Examples include persistent memory, scheduled execution, remote nodes, browser control, sandboxing, multi-agent delegation, and messaging channels.
_Avoid_: feature (too product-oriented), mechanism (how a Capability is implemented), plugin (one possible mechanism).

**Mechanism**:
The architectural means by which a Capability is provided, such as a plugin, service, process, sandbox, protocol, built-in subsystem, or external runtime layer.
_Avoid_: capability (what is enabled), implementation detail (too broad).

**DSH Comparison Classification**:
The relationship between a researched Capability and DSH, recorded as exactly one of: Equivalent, Packaging Gap, Plugin Opportunity, Core Gap, or Not Applicable.
_Avoid_: support level, score, ranking.

**Equivalent**:
DSH already provides the Capability adequately, even when its Mechanism differs from another harness.

**Packaging Gap**:
DSH has the primitives for the Capability, but another harness provides a materially stronger integrated or user-facing experience.
_Avoid_: missing feature (the underlying Capability is not missing).

**Plugin Opportunity**:
The Capability is not adequately available in DSH today and appears to fit naturally within DSH's plugin/service extension model.

**Core Gap**:
The Capability cannot reasonably be supplied by an ordinary DSH plugin and appears to require a change to the harness, runtime, trust boundary, or another core architectural seam.

**Not Applicable**:
The Capability is useful in the source harness but is not relevant or desirable for DSH's intended role.

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

### Preset authoring

**Session Preset**:
The preset already locked to the running conversation. Authoring another preset never changes it.
_Avoid_: current preset (ambiguous with the selected authoring target).

**Target Preset**:
The preset selected for inspection or authoring, independently of the Session Preset.
_Avoid_: session preset, active preset.

**Preset Draft**:
A complete candidate directory tree for one Target Preset, retained separately from the saved preset until Apply. It includes preset-local skills and assets, not only composition YAML.
_Avoid_: Draft (already means a proposed narrative answer in the Grilling context), patch, YAML draft.

**Source Fingerprint**:
The canonical whole-tree identity of the saved Target Preset from which a Preset Draft was opened.
_Avoid_: file hash (the identity covers every file in the preset directory), Git revision (one possible history mechanism).

**Stale Preset Draft**:
A Preset Draft whose Target Preset no longer matches its Source Fingerprint.
_Avoid_: invalid draft (the candidate may be valid; its saved base changed).

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
