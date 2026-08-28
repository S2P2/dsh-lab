# DSH baseline: DeepSeek Harness architecture & capability surface

**Verdict.** DeepSeek Harness (DSH) is the most composition-orthogonal agent harness in the current field: a single Cordis plugin tree in which *every* product capability — model adapters, tool registry, session log, the agent loop itself, permissions, even the Web UI — is a swappable config row, with no privileged core to patch. Two structural decisions drive everything else: (1) the **append-only session event log** is the single source of truth ("model-visible means logged", enforced by a runtime invariant), with history, UI, telemetry, fork/resume, and search all derived from it; and (2) the **capability seam** (Service Definition + Provider + Consumer, usually in separate packages) is the mandatory unit of extension, so a provider swap (e.g. filesystem → E2B) moves whole tool families without forking consumers. Later harness profiles should be compared against DSH's vocabulary of *seam/profile/bundle/preset/scope/projection/turn-step-round*, not its feature list — several expected dimensions (memory/learning, browser/computer control, chat channels, cron scheduling) are deliberately absent, and absence is data.

- **Researched:** 2026-08-30 · **Baseline for:** Agent Harness Capability Map (18 harness profiles; this is #1)
- **Verified against:** `deepseek-harness` checkout at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (2026-08-21); `git ls-remote origin` at research time returned the same SHA for `master`/`HEAD` → **not stale**.
- **Key sources:** local checkout `docs/` (architecture.md, capability-seams.md, module-graph.md, glossary.md, tool-catalog.md, subsystems/*.md, bundle patch YAMLs, preset YAMLs, package READMEs) + source spot-checks (`packages/core/session/src/types.ts`, `packages/sandbox/*`, `apps/cli/src/args.ts`); product page https://www.deepseek.com/harness/en/ (live-fetched 2026-08-28; zh variant fetched same day for the slogan); Cordis paper https://github.com/cordiverse/paper (preprint, active revision; exact title *"A Programming Paradigm for Spatiotemporal Composability"* — note the ticket's "Composibility" is a misspelling).
- **Method:** narrative docs treated as claims; every load-bearing claim cross-checked against bundle patches (`packages/bundle/*/cordis.patch.yml`), preset files (`apps/cli/config/agent-presets/*/agent.cordis.yml`), or source. Discrepancies recorded in the table below.

## 1. Positioning & declared surface (product page → verification)

| Product-page claim (deepseek.com/harness/en/) | Status | Evidence |
|---|---|---|
| "Everything is a plugin"; Cordis kernel carries no agent capabilities, only mount/unmount/dependencies | ✅ verified | `docs/architecture.md` §Cordis: "Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself"; kernel is vendored Cordis (`vendor/`) |
| Capabilities as plugins: "models, tools, skills, sessions, sandboxes, storage, loops, scheduling, and the UI" | ✅ mostly; **scheduling is opt-in** | All exist as packages; `schedule` is mounted by *no* shipped bundle (see §Discrepancies) |
| Compose with configuration, without changing DSH source | ✅ verified | Profiles → bundles → `cordis.patch.yml` layering; `dsh --dump-config`; presets (`docs/architecture.md` §Profiles and bundles) |
| "Every run is traceable": append-only log of prompts, reasoning, tool calls/results, subagent scheduling, context injections; Trajectory view; resume/fork/search/replay over one stream | ✅ verified | `SessionEventMap` + `session/event`; `client-ui-trajectory` row; `ctx.sessionQuery`; `llm-replay` |
| 4 runtime modes: **Standard / Code / Minimal / Creator** | ✅ verified as *agent presets*, not profiles | `apps/cli/config/agent-presets/{standard,code,minimal,cordis}/agent.cordis.yml`; "Creator" = the `cordis` preset (self-referential toolset + composition-authoring skill) |
| `npx @deepseek-ai/dsh web` → Web UI at `127.0.0.1:3080` | ✅ verified | `README.md`; `apps/cli/src/args.ts` (`web` = alias of `--profile web`) |
| Developer preview, breaking changes; MIT; local-first | ✅ verified | `README.md`; telemetry default `DISABLED` (`DSH_TELEMETRY_MODE` gate, base patch `session-telemetry-otel` row) |
| "Community plugins" link | ✅ verified — external, not first-party | Live-fetched 2026-08-28: all four "Community plugins" nav/footer links target https://github.com/topics/dsh-plugin (GitHub topic index), not a DeepSeek-run marketplace; no marketplace code in-repo; distribution = npm + `dsh plugin` (pnpm forwarding). Third-party catalog stores exist (e.g. `DshMarketPlace/dsh-plugins-store`) |

Positioning formula (page): **"Agent = Model + Harness."** Chinese slogan: "一切皆插件，运行有迹可循" ("Everything is a plugin. Every run is traceable.").

## 2. Composition model: Cordis (the five ideas that matter)

Cordis (`vendor/cordis`, paper: cordiverse/paper, arXiv:2608.25512 **v1** — only revision, submitted 2026-08-26, 92 pp., cs.PL/cs.SE; authors Yifan Shi (PKU & DeepSeek-AI), Wei Zhang (PKU), Tianyi Cui (DeepSeek-AI) — **preprint under active revision**, "cite the latest version"; repo draft pinned "August 26, 2026" @ commit `bb8b29ff83`, whose `paper.pdf` is byte-identical to the arXiv v1 PDF, sha256 `390775db…`) is a plugin framework whose formal rationale is **spatiotemporal composability** — the paper names its discipline the *context paradigm*: *temporal* = a component's side effects can be completely reverted on removal; *spatial* = inter-component dependencies are declared and reactively managed. The paper lifts effect/coeffect theory into runtime mechanisms (tracked effect inverses = *revertible effects*; *reactive coeffect* classification; a *calculus of dynamic composition*). ⚠️ **The paper never mentions DSH**: no "flagship application" claim, no "DSH"/"DeepSeek Harness" anywhere in the text (word-scan of the full 92-page PDF); DeepSeek appears only as an author affiliation, agent harnesses only as generic motivation. "DSH is the flagship application" is our inference from DSH vendoring Cordis — do not cite it as a paper claim. What a profile author needs (`docs/cordis-primer.md`):

1. **A plugin is an object implementing `Service`** — a function with optional `inject`/`apply(ctx)`, or a `Service` subclass mounted into a context.
2. **A context is a repository of services** — a plugin claims a stable `ctx.<key>` (`ctx.tools`, `ctx.llm`); consumers resolve by key, never by import. Duplicate service load **throws** (fail-loud composition).
3. **Dependencies via `inject`** — load order emerges from service availability, not boot sequencing.
4. **Typed events, four dispatch modes** — `emit` (observe), `waterfall` (around-middleware, must call `next()`; return without `next()` short-circuits), `parallel`, `serial`. The mode is part of the event's public contract (`@mode`-checked by generated catalogs).
5. **Registrations are reversible effects** — `ctx.effect()`/`ctx.on()` return disposers; unload/HMR unwinds every registration deterministically. This is what makes "everything is a plugin" survivable at runtime.

Loader config supports `!!js` expressions (e.g. `disabled: !!js process.platform === 'win32'`) interpolated against plugin context — the mechanism behind DSH's platform-gated rows and env-seam config (`docs/cordis-primer.md` §Loader Configuration; `@deepseek-ai/cordis-plugin-include`).

**Composition layering** (`docs/architecture.md` §Profiles and bundles; `apps/cli/README.md`): a **profile** (named dir under `$DSH_HOME/profiles/<name>`, `dsh.profile` manifest listing bundles) stacks **bundles** (distribution format = `cordis.patch.yml` rows + code, `dsh.bundle.patch` manifest field) over an empty root: bundles in listed order → profile `cordis.patch.yml` → home-level patch → `--patch` overlays. A patch targets a row by id and **replaces its whole config** (no deep merge). `dsh-base` is layer 1 of every profile; `dsh-web-app` and `dsh-headless` are the shipped mode bundles; `web`/`headless` ship as auto-initializing templates. Any other profile is created via `dsh plugin`.

## 3. Runtime & agent-loop architecture

- **Loop hierarchy** (glossary.md): **turn** = one drain of admitted input; **step** = one model request + its tool executions; **round** = an outer policy iteration (goal round, Ralph round). Turn flow (`docs/architecture.md` §Turn flow): `turn/start` → claim inbox → `agent/pre-step` (waterfall: reject | enter) → `step/start` → `user/message` → prompt assembly → `agent/request` → `llm/stream` → `assistant/chunk*` → `assistant/message` → `tool/call*` → `tools/pre-execute` → guards → `tools/execute` → `tools/post-execute` → `tool/result*` → `step/end` → (`agent/turn-stopping`, serial) → `turn/end`.
- **Spine services** (`docs/architecture.md` §Core packages): `ctx.sessions` (append-only store), `ctx.systemPrompt` (section/tool-schema assembly), `ctx.tools` (registry + guarded pipeline), `ctx.agents` (live Agent handles, create/resume factory), `ctx.agentLoop` (the *one* concrete driver — itself a bundle row; extensions depend on `agent`, never `agent-loop`), `dsh-scope` (library). `ctx.llm` owns message/stream vocabulary + adapter seam.
- **Session log** (`packages/core/session/src/types.ts`, `docs/subsystems/session.md`): `SessionEventMap` core = `turn/start|end`, `step/start|end`, `user/message`, `assistant/chunk|message`, `tool/call|result`, `todo/write`, `request/header|context`, `session/end-seed` (13 variants; plugin declaration-merging adds `compaction/*`, `goal/change`, `plan/mode`, `team/*`, `schedule/change`, `hook/*`, …). Only `user/message`/`assistant/message`/`tool/result` are *surface* events (can carry `surfaceOp` replace ops for compaction). `deriveMessages()` projects model history; raw chunks preserve replay fidelity. **Invariant: anything model-visible must be reconstructable from the log** (runtime-asserted by `ctx.invariants` companions).
- **Agent handle** (`docs/subsystems/core.md`): `inbox` (append/prepend/splice/claim; `next-turn` vs `next-step` targets), `status`, `cancel` (cause + `keepInbox`), `whenIdle`, `steer`, `inject`, per-agent scoped `ctx` (`agent.ctx`) — registrations through it are scope-visible *and* scope-lifetime. Scoped tools/sections shadow same-named globals; `tools.restrict` filters globals per scope (hidden + refusing, "one visibility").
- **Durability** (`docs/subsystems/persistence.md`): flush checkpoint per model request (`session-checkpoint-policy`), crash recovery closes an orphaned `turn/start` with synthetic `turn/end {interrupted}`, JSONL backend = checksummed **zstd** frames; `SESSION_FORMAT_VERSION = 0`, no migration (pre-release stance).
- **Entry surfaces**: `dsh web` (browser app), `dsh --profile headless "task"` (one-shot: fresh persisted agent, final assistant text → stdout, exit code from last `turn/end`), `dsh plugin` (pnpm forwarding). Launcher parses only its own flags; the rest belong to the booted app (`apps/cli/README.md`).
- **Presets = per-session agent plane** (`apps/cli/config/agent-presets/*/agent.cordis.yml`): the web bundle *disables* the base's agent-facing tool rows and mounts per-session preset compositions instead (`ctx.agentPresets`). Host plane keeps registries/persistence/sandbox/model route; a preset owns tools/persona/prompt sections inside `isolate` realms (an entry-local realm = private service instance per mounted session; `dsh-agent-presets` rejects root-realm publishes). Shipped: `standard`, `code` (Standard + `tool-presentation: mode: code`), `minimal` (fixed prompt; persistent PTY `bash`/`pwsh` + `str_replace_editor`; **no compaction**; local `fs-local` *shadows* the sandboxed provider inside its realm), `cordis` (= page's "Creator": Standard + `tool-cordis` + composition-authoring skill; docs treat it as shell-equivalent trust).

## 4. Extension architecture (how plugins extend DSH)

- **Manifest & duality**: a plugin package declares `dsh.profile` (profile manifest), `dsh.bundle` (bundle patch pointer), and/or `dsh.client` (browser roster row: `platform: 'web'`, optional `inject` edges, optional `immediately`) in `package.json`. Host half = normal Cordis plugin (`exports "."`); browser half = separate client module (`exports "./client"`), scanned by `dsh-client-modules` into the `window.__DSH_BOOT__` boot graph (rev-hashed entries, `/plugins/<id>/client.js?rev=<rev>`, no-cache) — the browser shell kernel assembles the module table *before* Cordis exists; client bundles must be value-import-pure (a value import fails the client purity gate). Electron builds bypass the webserver entirely (`file://` + IPC) (`docs/subsystems/client-modules.md`, web-app patch comments).
- **Seams are the unit** (`docs/capability-seams.md`, generated + completeness-guarded): ~50 `ctx.*` services classified `core` / `seam` / `bundle`, each with owner package, implementations, consumers, companion plugins. Canonical example: `dsh-shell` (definition) / `dsh-bash-local`·`dsh-bash-sandbox` (providers) / `dsh-tool-bash` (consumer). "One role alone is not a seam."
- **Events are the extension points** — three domains (`docs/architecture.md` §Events): session events (durable facts), agent events (`agent/*`, live interception), capability events (`fs/*`, `tools/*`, `telemetry/*` policy attachment). "Where new behavior goes" table maps goal → mechanism (add provider → `ctx.llm`; add tool → `ctx.tools`; confine spawns → `ctx.sandbox`; intercept turn → `agent/*`; UI → drive `ctx.agents` + render `session/event`; …).
- **Same-world providers move in groups**: `ctx.fs` + `ctx.subprocess` providers share one execution world — pointing them at E2B moves Bash, PTY, and LSP with them (`docs/architecture.md` §Capability seams).
- **Dynamic (in-session) extension**: `tool-cordis` (Creator preset) defines/inspects/runs/stops model-authored Cordis packages in a vm sandbox via `ctx.dynamicCordisRunner`; a running dynamic package may register *additional* model-visible tools (`docs/tool-catalog.md`). Explicitly a trust boundary, not a sandbox.
- **Distribution**: `dsh plugin --profile <name> add|remove <pkg>` runs pnpm in the profile dir; sources = npm package, local path, tarball, or `github:user/pkg#<sha>` (git installs run the author's `prepare` build script — users must `allowBuilds`-allowlist it; the docs frame installing as executing vendor code). Restart applies. No first-party marketplace in-repo; ecosystem convention = `dsh-plugin` GitHub topic + community catalog manifests (`docs/user/develop/basic/publish.md`). HMR: host plugins hot-swap via Cordis loader (config edit = unload/load, safe because registrations are effects); client bundles reload via the always-mounted `dsh-client-hmr` chain (idle until a rebuild watcher rewrites bundles).
- **UI slots** (concrete, docs-attested): `conversation.chat.node` (keyed business nodes via `ConversationNodeDefinition`), `conversation.chat.assistant-actions` (list slot, e.g. feedback entry), `settings.plugin.item` (keyed per settings namespace); registered browser-side with `ctx.slots.inject/register` — the general dual-face pattern for third-party UI (`docs/cookbook/adding-a-conversation-node.md`, `docs/subsystems/feedback.md`).

## 5. Capability surface, dimension by dimension

Format: **capability** — what it enables · mechanism (exact identifiers) · evidence. Shipped-by-default = mounted by `dsh-base`/`dsh-web-app`/presets unless marked **opt-in**.

### D1 Agent/runtime architecture
- **Event-sourced session log** — durable replayable conversation state; everything derives from it · `ctx.sessions`, `SessionEventMap`, `deriveMessages()` · `docs/subsystems/session.md`, `packages/core/session/src/types.ts`
- **Turn/step loop with admission control** — plugins reject/rewrite model input before a step; rejected first claim still closes a durable turn · `agent/pre-step` waterfall, `PreStepDecision` · `docs/architecture.md` §Turn flow
- **Swappable loop driver** — the agent loop is one bundle row, replaceable from config · `ctx.agentLoop` (classified `bundle` in seam table) · `docs/capability-seams.md`
- **Per-agent scoped registration** — tools/sections/variables scoped + shadowing + restriction per agent; two flat levels, lineage as data · `dsh-scope`, `agent.ctx`, `tools.restrict` · `docs/glossary.md` §agent-scope
- **Runtime invariant checks** — package-owned consistency assertions over authoritative streams, child-fiber isolated · `ctx.invariants` · `docs/subsystems/invariants.md`

### D2 Extension/plugin architecture
- **Everything-is-a-plugin composition** — replace any capability by config layering, no source patches · profiles/bundles/`cordis.patch.yml`/`--patch` · `docs/architecture.md`, `apps/cli/README.md`
- **Capability seams** — three-role swappable capabilities with generated ownership graph · ~30 seams in `docs/capability-seams.md`
- **Typed event interception** — four dispatch modes, waterfall short-circuit for policy · Cordis events; `@mode` tags · `docs/cordis-primer.md`
- **Per-session agent presets** — one session's composition (tools/persona) without touching the host plane · `ctx.agentPresets`, `isolate` realms, shipped 4 presets · web-app patch §agent plane
- **In-session dynamic plugins** — model authors/mounts Cordis packages live (Creator) · `tool-cordis`, `ctx.dynamicCordisRunner` · `docs/tool-catalog.md`
- **npm plugin distribution** — install out-of-tree plugins into a profile · `dsh plugin` → pnpm · `apps/cli/README.md`

### D3 Tools / MCP / protocols
- **Guarded tool pipeline** — pre-policy (`tools/pre-execute`, allow/deny/ask + `ctx.approval`) → monotonic deny-only guards → around-dispatch (`tools/execute`) → post-policy (`tools/post-execute`: accept/block/replace/addContext) → `finalizeContent` → `tools/result`; frozen arguments (never rewritten) · `ctx.tools` · `docs/tool-execution-pipeline.md`, `docs/subsystems/tools.md`
- **Stock tool catalog** (shipped in `standard` preset unless noted): `bash`/`pwsh` (one-shot, fresh process, `run_in_background`→jobs), `edit`/`read`/`write`/`read_image`, `str_replace_editor`, `glob`/`grep` (packaged ripgrep via `ctx.subprocess`), `ask_user_question`, `todo_write`, `skill`, `web_search` (fetch shipped but **disabled**), `subagent`+`subagent_fork`, `send_message`/`interrupt_agent`/`list_agents`, `job_kill`/`job_list`/`job_output`, `create_goal`/`get_goal`/`update_goal`, `exit_plan_mode`, `workflow`, `ralph`, `run_code` (Code Mode only). Opt-in: `terminal_*` (6 PTY tools), persistent `bash`/`pwsh` (minimal preset), `lsp`, `session_*` query tools (5), `schedule_*`, `cordis_*` (7), agent-team tools (10, experimental) · `docs/tool-catalog.md` (generated, boots real contexts)
- **Code Mode** — model writes one TS program calling tools as async functions (`run_code`); sub-calls re-enter the full guarded pipeline, submission-ordered, bounded parallel · `ctx.codeRuntime`, `dsh-tools mode: code|both`, `code-runtime-worker-thread` · `docs/subsystems/code-runtime.md`
- **MCP client bridge** *(opt-in, no shipped bundle mounts it)* — external MCP servers' tools as native `mcp__<server>__<rawName>`; stdio + streamable-http; generational re-sync, budgeted reconnect; tools-only (Resources/Prompts deferred) · `dsh-mcp-client` · `packages/mcp/mcp-client/README.md`
- **ACP agent-side server** *(opt-in composition)* — automation-only JSON-RPC stdio: fresh agents, prompts, one-shot permissions, cancel; no resume/list/editor features · `dsh-acp` · `packages/acp/acp/README.md`
- **External harnesses as subagent providers** *(opt-in bundles)* — Codex, Claude Code, generic ACP agents spawn through `ctx.subprocess` behind the one subagent seam · `subagent-codex`, `subagent-claude-code`, `subagent-acp` · `docs/capability-seams.md`
- **Embedding SDK** — typed JSON-RPC server + client packages; Python SDK (`pip install deepseek-harness-sdk`) bundles its own runtime (no system Node; Linux/macOS) and drives the minimal two-tool composition headlessly (`jsonrpc-agent` = benchmarking variant) · `sdk-jsonrpc-server`, `sdk-client`, `docs/user/guide/python-sdk.md`, `BENCHMARK.md`
- **LSP navigation seam** *(opt-in)* — exactly 4 normalized ops (definition/references/implementation/hover), no protocol escape hatch · `ctx.lsp`, `lsp-local`, `lsp` tool · `docs/subsystems/lsp.md`

### D4 Skills / instructions
- **Filesystem skill discovery** — SKILL.md bundles from layered roots (project `.dsh/skills` > `.agents` > custom > user > bundled), kebab-case names, duplicate resolved nearest-layer-wins · `ctx.skills`, `skill-filesystem` · `docs/subsystems/skills.md`
- **Progressive disclosure** — catalog injected as `<system-reminder>` at first pre-step; full body loaded on `skill` call; write/edit invalidates · `tool-skill` · same
- **Repo instruction files** — AGENTS.md-style instructions injected (64 KiB cap) · `agent-instructions` · base patch row
- **Plan mode** — logged per-agent mode; exploration-only policy; `exit_plan_mode` approval gate over the user-questions seam; tool catalog stays constant across modes (KV-cache stability) · `ctx.planMode`, `plan/mode` event · `docs/subsystems/plan.md`

### D5 Models / provider routing
- **Multi-provider adapter registry** — native DeepSeek adapter (direct fetch) + `llm-pi-ai` multi-provider twin mounted **dormant** (zero routes until settings supply profiles) + replay adapter · `ctx.llm` · base patch `llm-deepseek`/`llm-pi-ai` rows
- **Settings-driven activation** — `$DSH_HOME/settings.yaml` hot-reloaded; the web Models page writes provider profiles (catalog providers incl. Anthropic/OpenAI; Bedrock/Vertex/Azure/Codex need native auth; custom OpenAI-compatible providers with permanent IDs, `GET /models` discovery, per-model vision `input:[text,image]`, and gateway compat switches `compat.*`); keys resolve per request · `ctx.settings`, `settings-file` · base patch comments, `docs/user/guide/providers.md`
- **Shared default-model state** — one default ModelSelection layered through settings for all entrypoints; default `deepseek-official` / `deepseek-v4-flash` · `ctx.agentDefaultModel` · base patch
- **Bounded retry** — provider-aware retry policy (default 5 eligible retries), logged `llm/retry` events · `llm-retry`, `ResolvedRetryPolicy` · `docs/subsystems/llm-streaming.md`
- **Usage-accurate streaming** — `StreamChunk` closed union; `usage` before `finish`; adapters disable library retries (one call = one attempt) · `ctx.llm.stream` · same

### D6 Context management
- **Pressure compaction via surface replacement** — shadowed span replaced by one summary `user/message` with `surfaceOp: replace`; triggers = pressure + context-overflow recovery · `ctx.compaction`, `compaction-basic`, `compaction/*` events · `docs/subsystems/compaction.md`
- **Tool-result pre-pruning** — model-free rewrite of oversized current tool results before summary compaction · `ctx.toolResultPruner` · `packages/compaction/compaction-tool-result-pruner`
- **Oversized-output spill** — over-cap tool text persisted to disk, model gets locator + retrieval hint · `ctx.spillStore`, `spill-policy` (50 KB inline default) · `docs/subsystems/spill.md`
- **Token metering** — isolated per-session replay folds, revisioned immutable measurements shared with compaction + UI · `ctx.tokenMeter` · seam table
- **Request-header epochs** — full next-request header snapshotted per step (`request/header`), route changes logged separately · session log · `docs/subsystems/session.md`

### D7 Memory / learning
- **None built-in.** No cross-session memory, no learning/self-modification of behavior from history. Static assets only (skills, AGENTS.md). Adjacent building blocks a deployment could compose: opt-in cross-session query tools (`tool-session-query`), domain KV storage, message feedback records. DSH treats this as out-of-scope rather than missing — say "absent by design scope" when profiling. · seam table; `docs/subsystems/session-query.md`

### D8 Multi-agent / subagents
- **One-shot delegation** — self-contained task to a fresh child; optional `outputSchema` (structured output), `toolFilter`, `persona`, depth caps · `ctx.subagents.start`, `spawn`/`fork` providers · `docs/subsystems/subagent.md`
- **Continuable background children** — persisted child session + ≤1 live **Activation**; follow-ups route by state (enqueue/wake/cold-resume); `Activation` never persists (resume/fork disarm — human re-authorization required) · `prepareContinuable`, `send_message`, `interrupt_agent`, `list_agents` · same + glossary
- **Child→parent report channel** — child-scoped `report` tool delivering into the direct parent session · `tool-subagent-report` · tool catalog
- **Fresh-agent Ralph loop** — immutable objective, one fresh child per round, bounded handoff report, round cap (default 64) · `tool-ralph` over `ctx.workflowEngine` + `ctx.subagents` · glossary §Ralph
- **Workflow scripts** — model-written plain-JS orchestration (`agent()`/`pipeline()`/`parallel()`/`phase()`); no fs/network/timers in-script; one worker thread per run · `ctx.workflowEngine`, `workflow-worker-thread`, `workflow` tool · `docs/subsystems/workflow.md`
- **Agent Teams (experimental)** — named durable teammates, peer mailbox, shared CAS task DAG with blockedBy edges, Lead-only spawn/interrupt; **mounted by no shipped bundle** · `ctx.agentTeams`, `experimental-agent-team` · `docs/subsystems/agent-team.md`
- **Isolation model** — every child gets a new flat scope (no inherited registrations); depth = durable `delegationDepth` + runtime `subagentDepth`; fork seeds a balanced completed-turn prefix · subagent.md §depth and seed

### D9 Scheduling / background work
- **Generic background jobs** — kind-agnostic registry (bash, PTY sends, subagent delegations register); model reads/lists/kills via `job_*`; per-owner concurrency cap (default 10); settlement notices injected into the model turn · `ctx.jobs`, `jobs-local`, `tool-jobs` · `docs/subsystems/jobs.md`
- **Session-local reminders** *(opt-in plugin)* — `after_seconds` / absolute `at` / fixed-rate `every_seconds ≥ 300s`; delivery only to a live root agent via normal later turn; "no calendar or Cron expression, recurrence time zone, shared cooldown, or cross-record admission gate" · `dsh-schedule`, `schedule/change` events · `docs/subsystems/schedule.md`
- **Goal-round continuation** — same-session long-run objectives across rounds (see D19 recovery pairing) · `goal-round-driver` · glossary §goal
- **No cron/daemon/wall-clock scheduler** — absence is deliberate at v1.

### D10 Channels / messaging
- **Web UI** — browser app over loopback HTTP (default `127.0.0.1:3080`), `--no-open`, SSH launch prints URL only · web-app bundle
- **Headless one-shot** — CLI task in, final answer to stdout, exit code from `turn/end` · headless bundle
- **ACP stdio** — editor/programmatic clients (automation-only subset) · `dsh-acp`
- **JSON-RPC SDK** — embed DSH agents in other software; Python SDK guide · `sdk-jsonrpc-server`
- **No chat-platform channels** (Slack/Telegram/email/webhook in/out) — absent.

### D11 Remote / mobile / nodes
- **SSH remote launch** — detects `SSH_CONNECTION`/`SSH_TTY`, suppresses browser handoff, prints canonical URL · web-app runtime plugin
- **LAN trust fence** — bind-dependent LAN sampling once at boot, `--trusted-host` extras, browser-side trustedHosts enforcement · `webRuntime`, `connection` row
- **E2B cloud sandbox** *(opt-in)* — one shared E2B SDK handle; `fs-e2b` + `subprocess-e2b` move fs+shell+LSP into one remote Linux runtime · `ctx.e2b` · seam table
- **No mobile client, no multi-node/clustering story** — single host process per profile; absence is data.

### D12 Computer / browser control
- **None.** No browser automation, no screen/computer-use tools, no DOM capture. `web_fetch` exists as a provider+tool but ships **disabled** (`fetch: false`) with the rationale documented inline (deferred SSRF protection; the model would choose request targets). `read_image` reads local image files only. · base patch `tool-web` row; `packages/web/web-fetch-http`

### D13 Sandbox / permissions / security
- **File-effect sandbox modes** — `read-only` / `workspace-write` / `danger-full-access`; default `workspace-write` (`DSH_PERMISSION_MODE` override); same-world confinement only (containers/microVMs replace whole seams instead) · `ctx.sandbox`, `sandbox-policy` · `docs/subsystems/sandbox.md`
- **OS confinement runners** — Linux: bwrap preferred, else Landlock launcher (`node-addon-landlock-run`); macOS: Seatbelt (`sandbox-exec`); Windows: ACL `WRITE_RESTRICTED` token runner (deterministic workspace SID + per-session temp SID + `KILL_ON_JOB_CLOSE` job object); enforcement honestly reported `full`/`partial` (Windows ACL and old Landlock ABIs are partial); fail-closed (`SANDBOX_UNAVAILABLE` refuses unconfined spawn) · `sandbox-local`, `sandbox-windows-acl` · package READMEs (verified against `packages/sandbox/sandbox-local/src/index.ts`)
- **One-shot approval waterfall** — `allowed-once` is the only grant; `never` enforced before dispatch; missing answerer ⇒ `unavailable` (fail closed); auditable `approval/asked`→`approval/decided` log pair · `ctx.approval` · `docs/subsystems/approval.md`
- **Permission presets** — user-facing selector bundling sandbox mode × approval policy (`workspace-write`+ask, `danger-full-access`+never, read-only+ask); one `permission/preset` event writes both knobs · `ctx.permissionPresets` · `docs/subsystems/permission-presets.md`
- **Filesystem freshness guards** — read-before-write/edit enforced via `fs/write-intent`/`fs/edit-intent`/`fs/observed` events (`FS_STALE_VERSION`, `FS_NOT_OBSERVED`) · `fs-observation-policy` · `docs/subsystems/filesystem.md`
- **One-shot escalation** — a denied call may retry once with `sandbox_permissions` + `justification`, granted per-call by approval · shell seam · `docs/subsystems/shell.md`
- **Plain HTTP carrier, no built-in auth** — webserver is plain `node:http`; no TLS/origin policy; `host: 0.0.0.0` is deliberate exposure left to the deployment · `ctx.webServer` config · `docs/subsystems/web-server.md`

### D14 Credentials / secrets
- **Reference-based credentials** — config carries env-var-name refs; values resolve per operation from env > `$DSH_HOME/.credentials.yaml` > project/user `.env`; rotation reaches the next request without restart; empty stored value = absent everywhere · `ctx.credentials`, `credentials-local` · `docs/subsystems/credentials.md`
- **Authorization flows** — pluggable interactive flows (e.g. OAuth) keyed by the record they write; one attempt per key; `authorization/settled` events · `ctx.authorization` · same
- **Wire hygiene** — web gateway serves value-free views; write-only storage; managed doc never materialized into process env · seam table `ctx.credentials` note

### D15 Persistence / sessions / state
- **Session log backends** — JSONL (checksummed zstd frames, packed chunk rows; default) or SQLite (`node:sqlite`, WAL); `$DSH_HOME/sessions` root · `ctx.sessionPersistence` + two backends · `docs/subsystems/persistence.md`
- **Durable attachments** — image bytes content-addressed outside the log; messages keep references resolved per request · `ctx.attachments`, `attachment-local` · seam table
- **Domain KV storage** — typed zod-validated records on interchangeable media (JSON files / SQLite), per-domain routing, `domain/changed` events · `ctx.storage`, `storage-domain` · `docs/subsystems/storage.md`
- **Session projections + cache** — pure log folds (titles, todo, goal, stats) served whole to clients; durable checkpoint rows so listings never load full logs · `ctx.sessionProjections`, `sessionProjectionCache` · `docs/subsystems/session-projection.md`
- **Fork / resume** — `ctx.sessions.fork(source, boundary?, childSessionId?)`; fork seeds a balanced completed-turn prefix; resume via `ctx.agents.resume` · session.md §fork
- **Workspaces** — directories-as-workspaces registry grouping sessions, stable ids, ordering · `ctx.workspaceRegistry` · `docs/subsystems/workspace.md`

### D16 UI / client-server separation
- **Loopback-first web architecture** — host = Node process (webserver + API gateway + all seams); browser = thin shell loading the client plugin graph; only `window.__DSH_BOOT__` is injected · `ctx.webServer` (plain `node:http` route registry), `client-modules` · web-app patch
- **Typed RPC gateway** — `@Remote()`-decorated service methods exposed as unary typed calls over the shared Connection RPC carrier (`POST /api/<ns>/<method>`); streams/pagination deliberately excluded · `ctx.typertGateway`, typert toolchain (generator/registry/loader/protocol) · `docs/api-gateway.md`
- **Full browser roster** — ~40 `client-ui-*` packages (conversation, sidebar, settings, models page, plugin inventory, plan, goal bar, jobs, subagents, trajectory, workflow-run, deliverables, message feedback, theme, locale…) mounted as `dsh.client` rows · web-app patch roster
- **Client HMR chain** — always-mounted reload receiver; no-refresh reload additionally requires the dev watcher · `client-hmr`
- **Slot-based UI extension** — third-party plugins occupy generic slots (sidebar/conversation/composer/settings) with their own bundles; dual-face pattern (host service + browser card) is the ecosystem norm · quota-plugin prior art (`docs/research/2026-08-dsh-quota-plugin-inventory.md` in this repo)

### D17 Deployment / VPS / cloud
- **npm-first distribution** — `npx @deepseek-ai/dsh web`; Node.js is the only runtime requirement; source = clone + pnpm · README
- **Profiles auto-initialize** — `web`/`headless` from shipped templates; custom profiles via `dsh plugin` · `apps/cli/README.md`
- **VPS/SSH story** — SSH launch mode + LAN trust fence (D11); no official container/cloud images
- **Local-first stance** — telemetry default-off, opt-in via `DSH_TELEMETRY_MODE`, opt-out env, anonymous id file · base patch telemetry row

### D18 Artifacts / documents / apps
- **Image attachments** — durable, content-addressed, capability-proven per route (only when the exact model declares image input) · `ctx.attachments` · seam table
- **Deliverables surface** — produced-files row under closing assistant messages · `client-ui-deliverables`
- **Session export/download** — `/export` command + download dialog · `session-log-export`
- **Spill artifacts** — oversized tool outputs retrievable from disk by locator · D6 spill
- **No canvas/artifacts/mini-app system** — absent.

### D19 Observability / recovery
- **Log-is-the-trace** — Trajectory view inspects records by source; transcript, telemetry, search, replay all read one stream · product claim + `client-ui-trajectory`
- **OTel telemetry seam** — capture/redact/dispatch waterfall; sharing disclosure required (`full`/`feedback-only`/`disabled`); backend exports raw captured copy when no redaction rule · `ctx.sessionTelemetry`, `session-telemetry-otel` · `docs/subsystems/session-telemetry.md`
- **Crash recovery** — orphaned open turns closed synthetically (`interrupted`); persistence format refusal vs corruption split; repair module · `docs/subsystems/persistence.md`, `packages/core/session/src/repair.ts`
- **Goal model** — same-session objectives: `active/paused/blocked/complete` phases, CAS revisions, round caps, blocked only after ≥3 admitted rounds, process-local activation disarms on restart · `ctx.goals`, `goal/change` · `docs/subsystems/goal.md`, glossary
- **LLM retry/failure logging** — `llm/retry`, `llm/retry-started`, canonical failure codes (`CONTEXT_WINDOW_EXCEEDED`, …) · llm-streaming.md
- **Postmortems in-repo** — `docs/postmortem/0001-0004` (culture signal: ACP export bug, JS-expression FS tools, web feedback loop, Landlock partial-notice misclassification)

### D20 Resource usage / scalability
- **Token accounting per message** — `TokenUsage` rides `assistant/message` (disjoint counters incl. cache read/write/reasoning); no separate usage record · session.md
- **Context-pressure projections** — per-session meter folds feed compaction + UI stats strip · `tokenMeter`, `session-stats`
- **KV-cache stability as a design value** — recurring documented rationale: stable personas/sections near prompt head, tool catalog constant across plan-mode transitions, `exit_plan_mode` always in schema, MCP re-sync reproduces identical definitions; every package README carries "KV Cache effect" sections · throughout docs
- **Concurrency bounds** — per-owner job cap, `maxParallelSubCalls` (Code Mode), tool `executionMode` (parallel/exclusive), one in-flight prompt per ACP session, whole-log batching windows on persistence · jobs.md, tools.md, acp README, persistence.md
- **Multi-session per host** — web host serves many concurrent sessions; registries keyed by session/agent (host-plane ownership criterion documented in web-app patch)

## 6. Documentation-vs-source discrepancies

| # | Doc claim | Source reality | Impact |
|---|---|---|---|
| 1 | `docs/subsystems/core.md`: "the twelve event variants" incl. `steering/message` | `SessionEventMap` (types.ts) has **13** core variants; no `steering/message` (steering is inbox delivery + `agent/inbox/*`); session.md matches source | core.md stale; harmless but misleads event-count audits |
| 2 | `docs/tool-catalog.md`: agent-team tools "shipped dsh-base bundle keeps the package disabled" | `packages/bundle/base/cordis.patch.yml` contains **no agent-team row at all** (absent ≠ disabled); enabling is via the documented Agent Teams profile patch | wording; tool genuinely unshipped |
| 3 | Product page: 4 **runtime modes** | Repo ships 3 bundles/profiles (base/web/headless) + 4 **presets**; "Creator" = `cordis` preset (name differs); "Minimal" is a preset, not a mode | vocabulary mismatch page↔repo |
| 4 | Product page capability list includes "scheduling" | `dsh-schedule` is opt-in; **no shipped bundle mounts it** (grep over bundle patches: zero matches) | page overstates default surface |
| 5 | `docs/tool-catalog.md`: `subagent_fork` "stays one-shot / defaults foreground" (citing base patch) | True for the TUI-plane base rows, but the shipped web `standard`/`code`/`cordis` presets mount fork as `backgroundMode: continuable` | catalog documents base only; web default differs |
| 6 | Ticket/docs imply subsystem coverage incl. MCP/context/todo | `docs/subsystems/` has **no** `mcp.md`, `context.md`, or `todo.md`; MCP documented only in package README + config catalog; todo lives in session.md | doc-map gap, not behavior gap |
| 7 | `ctx.e2b` (cloud sandbox) documented under `docs/subsystems/subprocess.md` | Correct but odd home — remote-sandbox capability documented inside the subprocess page | navigational only |
| 8 | sandbox docs describe Windows confinement | Source adds a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` job-object orphan backstop not stated in sandbox.md | minor doc omission |
| 9 | tool-catalog glob description "sampled across top-level entries" | Catalog boots `sampleOverCapGlobResults: true` but shipped presets set `false` (base row comment: "deployments must choose explicitly") | documented divergence, defaults differ |
| 10 | Cordis paper title as cited in ticket ("Composibility") | Actual title: *"…Spatiotemporal Composability"*; active preprint (Aug 13 → Aug 26 drafts) | cite the real spelling + version |

## 7. Baseline taxonomy (handoff artifact)

Canonical **dimension → capability names**. Later profiles reuse these names verbatim; where a harness lacks a capability, record "absent". Names are implementation-independent (DSH mechanisms in parentheses are illustrative, not definitional).

| # | Dimension | Capability names |
|---|---|---|
| D1 | Agent/runtime architecture | Event-sourced session log · Turn/step loop with admission control · Swappable loop driver · Per-agent scoped registration · Runtime invariant checks |
| D2 | Extension/plugin architecture | Config-layered composition (everything-is-a-plugin) · Capability seams · Typed event interception · Per-session presets · In-session dynamic plugins · Package-registry distribution |
| D3 | Tools/MCP/protocols | Guarded tool pipeline · Stock tool catalog · Code Mode (programmatic tool orchestration) · MCP client bridge · ACP server · External-harness subagent providers · Embedding SDK · LSP navigation |
| D4 | Skills/instructions | Filesystem skill discovery · Progressive skill disclosure · Repo instruction files · Plan mode |
| D5 | Models/provider routing | Multi-provider adapter registry · Settings-driven activation · Shared default-model state · Bounded retry · Usage-accurate streaming |
| D6 | Context management | Pressure compaction · Tool-result pre-pruning · Oversized-output spill · Token metering · Request-header epochs |
| D7 | Memory/learning | *(none — record "absent" variants explicitly)* Cross-session retrieval · Feedback storage · Behavioral memory · Learning loops |
| D8 | Multi-agent/subagents | One-shot delegation · Continuable background children · Child→parent report channel · Fresh-agent loops (Ralph) · Workflow scripts · Persistent teams · Isolation/depth model |
| D9 | Scheduling/background work | Generic background jobs · Session-local reminders · Long-run objective continuation · Cron/calendar scheduling |
| D10 | Channels/messaging | Web UI · Headless one-shot · Editor protocol (ACP) · SDK/RPC channel · Chat-platform channels |
| D11 | Remote/mobile/nodes | SSH remote launch · LAN trust fence · Cloud sandbox runtime · Mobile client · Multi-node clustering |
| D12 | Computer/browser control | Browser automation · Screen/computer use · Web fetch · Local image reading |
| D13 | Sandbox/permissions/security | File-effect sandbox modes · OS confinement runners · One-shot approval · Permission presets · Freshness guards · One-shot escalation |
| D14 | Credentials/secrets | Reference-based credentials · Interactive authorization flows · Secret wire hygiene |
| D15 | Persistence/sessions/state | Session log backends · Durable attachments · Domain KV storage · Projections + cache · Fork/resume · Workspace registry |
| D16 | UI/client-server separation | Loopback-first web architecture · Typed RPC gateway · Browser plugin roster · Client HMR · Slot-based UI extension |
| D17 | Deployment/VPS/cloud | npm-first distribution · Auto-initializing profiles · SSH/VPS story · Local-first telemetry stance |
| D18 | Artifacts/documents/apps | Image attachments · Deliverables surface · Session export · Spill artifacts · Canvas/mini-apps |
| D19 | Observability/recovery | Log-is-the-trace · OTel telemetry · Crash recovery · Goal model · Failure/retry logging |
| D20 | Resource usage/scalability | Token accounting · Context-pressure projections · KV-cache stability discipline · Concurrency bounds · Multi-session host |

DSH quick-fill (for the comparison grid): present = all names above except: D7 behavioral memory/learning loops (absent); D9 cron/calendar (absent); D10 chat-platform channels (absent); D11 mobile client, multi-node (absent); D12 browser automation, screen/computer use (absent; web fetch shipped-but-disabled); D18 canvas/mini-apps (absent). All others present with shipped defaults unless marked opt-in in §5.

## 8. Open questions / low-confidence

1. **Product page fidelity** — quotes reconstructed from search-index crawls (web_search only this session); today's rendering may differ. Low risk, but re-verify "scheduling"/modes wording before quoting externally.
2. **Cordis paper internals** — 2026-08-30 primary-source pass (full-text scan of the 92-page PDF): pinned arXiv v1 (2026-08-26); affiliations verified from the title page (1 Peking University, 2 DeepSeek-AI); formal apparatus ≈81 numbered items (definitions dominant; theorems to #80), no benchmark evaluation spotted. Preprint is actively revised — re-pin before citing.
3. **TUI references** — web-app patch and base comments reserve the agent plane "for the TUI, which is single-session", and `apps/cli` docs use `--profile tui` as a hypothetical; no TUI app ships in `apps/` (cli, web only). Unclear whether a TUI is planned, third-party, or vestigial.
4. **Marketplace trajectory** — no first-party catalog in-repo; community stores are emerging third-party. The distribution dimension may change fast.
5. **"Scheduling" on the page vs opt-in plugin** — is a composed schedule-enabled profile planned, or is the page claiming the seam's existence? Worth a follow-up when the page or repo updates.
6. **Windows parity** — bash stack entirely disabled on win32 (no Windows bash runner); pwsh is the only shipped shell there; ConstrainedLanguage interactions under read-only are documented but worth empirical confirmation when profiling Windows behavior.
7. **Unreleased-format stance** — `SESSION_FORMAT_VERSION = 0`, no migration paths, "compatibility-breaking changes" banner: this baseline describes a moving target; re-pin the SHA on every profile comparison.
8. **Event-mode vocabulary nuance** — `docs/cordis-primer.md` lists dispatch modes `emit/waterfall/parallel/serial`; `docs/user/develop/framework/events.md` lists `emit/bail/serial/waterfall`. Whether `bail` and `parallel` are both live harness vocabulary (vs upstream Cordis modes) was not resolved from the docs alone; check `vendor/cordis` before relying on either name in a comparison grid.
