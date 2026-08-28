# Microsoft UFO³ / UFO²: AgentOS architecture & distinctive capabilities

**Verdict.** UFO³/UFO² is this cohort's computer-use + multi-device outlier: a research GUI-agent OS for Windows (UFO²) with a living-DAG multi-device orchestration fabric (Galaxy) on top. Its three genuinely distinctive moves: (1) an **OS-native action space** — UIA accessibility trees + Win32/WinCOM + per-app API clients with GUI as fallback, inverting the screenshot-CUA model; (2) a **distributed execution fabric** — declarative Task Constellation DAGs that rewrite themselves at runtime, executed across Windows/Linux/Android device agents over a persistent WebSocket protocol (AIP) with capability-profile device matching; (3) **execution-trace recycling** — past runs vectorized into a RAG substrate alongside docs and live search. Against DSH: everything UFO does on the desktop sits in D12, DSH's headline recorded absence — and part of it is reachable today through DSH's opt-in MCP bridge (UFO's action layer literally ships as MCP servers), while its multi-device fabric and protocol are core gaps with no DSH seam. Conversely, UFO lacks nearly every DSH structural virtue: no plugin composition, no durable resumable sessions, no permission/approval model over its powerful GUI actions, no credential hygiene, no scheduling/goal model. Complementary rather than competing; the interesting boundary is UFO's MCP-served action layer meeting DSH's MCP client seam.

- **Researched:** 2026-08-28 · **Baseline for: Agent Harness Capability Map (profile #9 of 18)**
- **Key sources (primary):**
  - Repo `https://github.com/microsoft/UFO` (MIT; Python ~95% / TypeScript ~5%), pinned at commit `cd9bfdd6caacee7b8c5894605f42207ec84b6e47` (merge of PR #343, 2026-08-24; latest release v3.0.5 per repo Releases page at research time). Local shallow clone inspected at `%TEMP%\ufo-inspect`.
  - Papers: UFO — *A UI-Focused Agent for Windows OS Interaction* (arXiv:2402.07939; NAACL 2025); UFO² — *The Desktop AgentOS* (arXiv:2504.14603; TMLR 05/2026 per OpenReview); UFO³ — *Weaving the Digital Agent Galaxy* (arXiv:2511.11332).
  - First-party docs site `https://microsoft.github.io/UFO/` (source: `documents/docs/` in-repo — all in-repo doc citations below resolve there).
- **Method:** source + in-repo docs read at the pinned SHA; paper abstracts via arXiv landing pages. Load-bearing claims cite repo paths (`<path>` at `cd9bfdd`) or paper URLs. Inference and uncertainty marked inline.

## 1. System identity: one repo, three layers (UFO → UFO² → UFO³)

`microsoft/UFO` is a single MIT Python repository containing three chronological layers that remain simultaneously shipped and individually runnable (repo README "Choose Your Path"; docs timeline at `documents/docs/index.md`):

| Layer | Date | What it is | Entry point | Paper |
|---|---|---|---|---|
| **UFO** (v1) | 2024-02 | Dual-agent GUI agent for Windows (HostAgent/AppAgent, GPT-4V) | `python -m ufo` | arXiv:2402.07939 (NAACL 2025) |
| **UFO²** | 2025-04 | "Desktop AgentOS": the Windows device-agent runtime — deep OS integration (UIA/Win32/WinCOM), hybrid GUI+API actions, knowledge substrate, speculative execution, PiP desktop. Now in "LTS" status | `python -m ufo` | arXiv:2504.14603 |
| **UFO³ Galaxy** | 2025-11 | Multi-device orchestration fabric: decomposes requests into dynamic DAGs ("Task Constellations") executed across heterogeneous device agents over a WebSocket protocol (AIP) | `python -m galaxy` | arXiv:2511.11332 |

The relationship is **composition, not replacement**: "UFO³ = Galaxy (Multi-Device Orchestration) + UFO² (Device Agent)" (repo README). A Windows device running UFO², a Linux box, and an Android device each run a *device agent server*; the Galaxy client coordinates them. Repo layout mirrors this: `ufo/` (device agent, "can be Galaxy sub-agent" per `documents/docs/project_directory_structure.md`), `galaxy/` (client/agents/constellation/session/webui), `aip/` (protocol), plus `vectordb/`, `rag/`, `learner/`, `record_processor/`, `dataflow/` (knowledge/experience tooling).

Category note (for comparison discipline): UFO is a **research framework for GUI/computer-use automation and multi-device orchestration**, not a general-purpose coding/agent harness. It has no plugin marketplace, no editor integration, no session-fork/resume of conversations; its "session" is an automation run with recorded trajectories.

## 2. The AgentOS model (UFO²)

**The claim:** UFO² is a "Windows AgentOS that reimagines desktop automation as a first-class operating system abstraction" — contrasting itself with (a) screenshot-and-simulated-input CUAs that "miss native OS APIs and application internals" and (b) traditional RPA (UiPath, Power Automate) with brittle recorded scripts (`documents/docs/ufo2/overview.md`).

What "AgentOS" concretely means — automation elevated to an OS-managed service with these OS-facing primitives:

- **Deep OS integration** (`documents/docs/ufo2/overview.md` §Deep OS Integration): **UI Automation (UIA)** accessibility-tree introspection for standard controls; **Win32** APIs for window management and process control; **WinCOM** for Office application automation; a **hybrid detection** pipeline fusing UIA metadata with a vision model ([OmniParser], arXiv:2408.00203) for non-standard/custom controls.
- **OS as scheduler substrate:** the HostAgent "operates atop the native Windows substrate, monitors active applications, issues shell commands to spawn new processes as needed, and manages the creation and teardown of application-specific AppAgent instances" (`documents/docs/ufo2/host_agent/overview.md`). I.e., agent lifecycle is mapped onto OS process/window lifecycle — AppAgents are created per target application, like processes under an OS kernel.
- **Non-disruptive execution (Picture-in-Picture):** a nested virtual desktop via Windows Remote-Desktop loopback so the agent works in a parallel sandboxed desktop while the user keeps the physical one ("Zero Interference: user and agent don't compete for mouse/keyboard", `documents/docs/ufo2/overview.md` §Picture-in-Picture). **Status caveat:** the main GitHub README's capability table marks PiP "(coming soon)" while the docs present it as implemented; source-truth on implementation maturity is flagged in §11.
- **Application internals as action space:** per-app native-API bindings — docs name `xlwings` (Excel), `win32com` (Outlook), `python-pptx` (PowerPoint) as "preferred" over GUI clicks, with GUI actions as universal fallback (`documents/docs/ufo2/overview.md` §Unified GUI–API Action Layer; detail in §4).

Efficiency/quality claims (their numbers, docs + paper): "10%+ better success rate than state-of-the-art CUAs" on WindowsAgentArena (154 tasks / 15 apps) and "51% fewer LLM calls" via speculative multi-action execution (`documents/docs/ufo2/overview.md`; paper arXiv:2504.14603; WAA benchmark page `https://microsoft.github.io/UFO/benchmark/windows_agent_arena/`).

Conceptual distinction worth keeping for the map: UFO²'s "OS" is *not* a process-isolation or resource-scheduling kernel for arbitrary agents (no containers, no quota, no multi-tenancy); it is a **control-plane metaphor** — one HostAgent "kernel" scheduling application-specialized AppAgent "processes" against OS APIs, plus OS-sourced abstractions (windows, processes, virtual desktops) as the automation surface.

## 3. HostAgent / AppAgent hierarchy & orchestration

**Two-tier hierarchy** (`documents/docs/infrastructure/agents/agent_types.md`, `documents/docs/ufo2/overview.md`):

- **HostAgent** — desktop orchestrator: parses the request, decomposes into subtasks, selects/launches applications (shell commands to spawn processes), creates/tears down/caches AppAgents (`appagent_dict`), steers a global FSM. Registered as `@AgentRegistry.register(agent_name="hostagent")`; holds `agent_factory` + `_blackboard` (`agent_types.md` source excerpts).
- **AppAgent** — one per target application ("isolated runtime", "application expert"): runs a ReAct loop per subtask with hybrid control detection, hybrid action execution, result reporting back to the HostAgent. Holds `process_name`/`app_root_name` bindings (e.g. `WINWORD.EXE`).
- **Blackboard** — shared coordination space between HostAgent and AppAgents ("inter-agent communication without tight coupling", `ufo2/overview.md`; dedicated doc `infrastructure/agents/design/blackboard.md`). Subtask results flow child→host through it.
- **FSMs:** HostAgent 7 states, AppAgent 6 states, Linux/Mobile agents 3 states (CONTINUE/FINISH/FAIL) — `ufo2/overview.md`, `linux/overview.md`, `getting_started/quick_start_mobile.md`. (Enum values in source not individually verified — §11.)
- **Uniform agent skeleton ("three-layer architecture"):** every platform agent implements `BasicAgent` with the same lifecycle (`handle`, `next_state`, `next_agent`) composed of State + Processor/Strategy + Command layers (`agent_types.md`); both Windows agents run a 4-phase cycle: Data Collection → LLM Interaction → Action Execution → Memory Update (`ufo2/overview.md` §Processing Pipeline).

Orchestration is strictly **hierarchical and synchronous within a device**: HostAgent delegates subtasks one AppAgent at a time; parallelism arrives only at the Galaxy layer (§6). AppAgent prompt/knowledge is application-specialized (per-app prompts + RAG retrieval).

## 4. Action space: hybrid GUI + native API, speculative execution

- **Puppeteer/automator layer:** `ufo/automator/puppeteer.py` (present at `cd9bfdd`) routes each decided action to a binding; UI control path under `ufo/automator/ui_control/` (control filtering/annotation for UIA trees + screenshots).
- **Native API clients in source** (`ufo/automator/app_apis/`): `excel/excelclient.py`, `word/wordclient.py`, `powerpoint/powerpointclient.py`, `shell/shell_client.py`, `web/webclient.py` — five families ship in-tree. Docs additionally name `xlwings` (Excel), `win32com` (Outlook), `python-pptx` (PowerPoint) as the "preferred" API surface (`ufo2/overview.md` §Unified GUI–API Action Layer). Docs-vs-source mismatch on Outlook bindings noted in §11.
- **Selection policy:** native APIs preferred; **GUI actions (`click`, `type`, `select`, `scroll`) are the universal fallback** — inverted vs screenshot-only CUAs (`ufo2/overview.md`).
- **Extensibility via MCP:** "Extensible framework for adding application-specific APIs without modifying agent code" — app/API tooling is packaged as MCP servers, which are also the remote-command substrate (`ufo2/overview.md`; `documents/docs/mcp/`).
- **Speculative multi-action:** one LLM call predicts N actions; "lightweight control-state checks ensure predicted actions remain valid before execution"; claimed **51% fewer LLM calls** (`ufo2/overview.md` §Speculative Multi-Action; paper arXiv:2504.14603). AIP transports this as command batching (§7). Exact implementing class was not located in a quick source grep (§11).

## 5. Execution traces & knowledge substrate

- **Three knowledge sources, retrieval-time fusion, no fine-tuning** (`ufo2/overview.md` §Continuous Knowledge Substrate): (1) **Help documents** (official app docs / API references, vectorized); (2) **Bing search** (real-time web knowledge); (3) **Execution history** ("past successful/failed action sequences; experience replay & pattern mining").
- **Supporting packages at repo root:** `vectordb/` (vector store layer), `rag/` (retrieval pipeline), `learner/` + `record_processor/` (execution-trace → experience pipeline). Docs: `documents/docs/ufo2/core_features/knowledge_substrate/{overview,learning_from_help_document,experience_learning}.md`. Offline-vs-online division and index formats not fully verified (§11).
- **Trajectories:** `ufo/trajectory/` records per-run execution; UFO² writes evaluation logs (`documents/docs/ufo2/evaluation/logs/overview.md`); Galaxy additionally generates a human-readable Markdown trajectory report `logs/galaxy/<task>/output.md` (step timeline, DAG topology evolution before/after each edit) plus machine-readable `result.json` with metrics (`parallelism_ratio`, `critical_path_length`, `modification_count`) (`documents/docs/galaxy/overview.md` §Performance Monitoring).
- **Loop closure:** execution traces are both an *observability artifact* and a *knowledge source* — past runs become retrievable experience for future runs.

## 6. UFO³ Galaxy: distributed multi-device execution

All from `documents/docs/galaxy/overview.md` unless noted:

- **Control/data plane split:** **ConstellationClient** = global control plane holding a live registry of device agents (capability profiles, health, load); each device runs a **device agent server** managing local orchestration over a persistent WebSocket session, exposing local tools via MCP servers.
- **Declarative DAG ("Task Constellation"):** the **Constellation Agent** (an LLM agent) decomposes a request into **TaskStar** nodes + **TaskStarLine** dependency edges, with device assignments. Dual mode: **Creation** (initial synthesis) and **Editing** (incremental refinement from completion events/runtime feedback).
- **Living-DAG evolution:** intermediate results/failures trigger controlled rewrites — diagnostic TaskStars, fallback creation, dependency rewiring, pruning of completed nodes — "instead of aborting on errors". `ConstellationEditor` provides undo/redo via command pattern.
- **Orchestrator:** `TaskConstellationOrchestrator` (`galaxy/constellation/orchestrator/`) executes asynchronously (Python asyncio), event-driven readiness (completions trigger dependents), with safety machinery: three formal invariants (I1–I3) checked at runtime, safe assignment locking, acyclicity validation, state-merging for concurrent edits, batched atomic edits, timeout protection.
- **Capability-based placement:** each TaskStar is matched to devices via **Agent Profiles** (OS, hardware, installed tools) plus runtime telemetry (load, GPU status — §7).
- **Topology:** devices are declared in `config/galaxy/devices.yaml` (`device_id`, `server_url` ws://, `os`, `capabilities[]`, `metadata`, `max_retries`); runtime knobs in `constellation.yaml` (`MAX_CONCURRENT_TASKS`, `HEARTBEAT_INTERVAL`, `RECONNECT_DELAY`, `MAX_STEP`).
- **Observability:** event bus + observer pattern (visualization/synchronization/metrics observers, `documents/docs/galaxy/observer/`); trajectory report + result.json per session (§5).

## 7. AIP protocol & remote operation

From `documents/docs/aip/overview.md` + `aip/` source tree (`protocol/`, `transport/`, `resilience/`, `endpoints/`, `extensions/`):

- **Positioning:** explicitly rejects "legacy HTTP-based coordination approaches (e.g., **A2A, ACP**)" as short-lived/stateless; AIP is a persistent, bidirectional **WebSocket** session protocol (per-request overhead eliminated, context preserved across tasks).
- **Five layers:** (L1) Pydantic-validated `ClientMessage`/`ServerMessage` schemas with ID correlation (`request_id`/`response_id`/`prev_response_id`/`session_id`); (L2) pluggable `Transport` (production WebSocket impl; configurable pings/timeouts); (L3) pluggable handlers — registration, task execution, heartbeat, command dispatch — with middleware hooks (logging, metrics, authentication listed as extension examples); (L4) resilience: `HeartbeatManager`, `TimeoutManager`, `ReconnectionStrategy` (exponential backoff with jitter), session recovery; (L5) role endpoints: `ConstellationEndpoint` (orchestrator), `DeviceServerEndpoint` (device service), `DeviceClientEndpoint` (local executor invoking MCP tools).
- **Messages:** `REGISTER`, `TASK`, `COMMAND`, `COMMAND_RESULTS`, `TASK_END`, `HEARTBEAT`, `DEVICE_INFO_REQUEST/RESPONSE`, `ERROR`. Execution logs stream back during task execution (not only at completion).
- **Determinism:** commands within a session execute **sequentially in order**; batching supported (multiple actions in one message, executed in order) — the transport half of speculative multi-action.
- **Failure semantics:** a disconnected device enters a `DISCONNECTED` quarantine (excluded from scheduling; its tasks marked FAILED → propagated to ConstellationAgent → DAG edit); auto-reconnect with backoff; if the *ConstellationClient* dies, device services abort their ongoing tasks ("no orphaned tasks").
- **AgentProfile from three sources:** user config (endpoint/identity) + service manifest (supported tools/capabilities) + client telemetry (OS, hardware, GPU, runtime metrics) — continuously refreshed.

## 8. Platform coverage: Windows / Linux / mobile

- **Windows (UFO²):** richest surface — two-tier agents, UIA + Win32 + WinCOM, hybrid UIA+vision detection, per-app API clients, PiP desktop (status caveat §11).
- **Linux (LinuxAgent):** deliberately minimal single-tier CLI executor — 3-state FSM, 3-phase pipeline, MCP tools `execute_command`/`get_system_info`; "Standalone agent (no child agents)"; docs point to `ufo/agents/agent/customized_agent.py` etc. (`documents/docs/linux/overview.md`). Equivalent to a thin shell-agent, not a GUI agent.
- **Mobile (Android):** ADB-driven **from a host PC** (Python host; Android 5.0+ physical device or emulator): `ufo.server.app --platform mobile` (device agent server) + two HTTP MCP servers — data collection (port 8020, 5 read-only tools: screenshot via `screencap`, UI tree via `uiautomator dump`, device/app info) and action (port 8021, 8 control tools: tap/swipe/type/launch-app) — 13 MCP commands total; device client `ufo.client.client --ws --platform mobile` registers over AIP; tasks dispatched via `POST /api/dispatch` (`documents/docs/getting_started/quick_start_mobile.md`, `documents/docs/mobile/`). No on-device agent; iOS not implemented ("Future Platforms" diagram, `agent_types.md`).
- **Extension template:** new platforms = implement `BasicAgent` (State/Processor/Command) + declare an AgentProfile + attach MCP servers (`documents/docs/tutorials/creating_device_agent/`; galaxy/overview.md §Template-Driven Framework).

## 9. Distinctive capability analysis (dimension-aligned vs DSH)

Format: **capability** — enables · mechanism · evidence → DSH relationship. Classes: Equivalent / Packaging gap / Plugin opportunity / Core gap / Not applicable. *(provisional)* flags explained inline.

| Capability (DSH dimension) | What it enables | UFO mechanism | Evidence | DSH relationship |
|---|---|---|---|---|
| **Screen/computer use — Windows GUI control** (D12) | Agent sees & operates real apps (click/type/select/scroll on UIA controls; screenshots + vision) | UIA tree + OmniParser-style visual grounding; AppAgent action executors; GUI actions universal fallback | `documents/docs/ufo2/overview.md`; `ufo/automator/ui_control/` | **Plugin opportunity** *(provisional)* — UFO's data/action MCP servers could be mounted via DSH's opt-in `dsh-mcp-client`; interactive-desktop reach needs DSH unsandboxed/full-access mode, outside the headless model |
| **API-first action selection** (D12/D3) | Faster, robust execution when the target app exposes APIs | Puppeteer routes to per-app API clients (`xlwings`, `win32com`, `python-pptx`, shell, web) before GUI | `ufo/automator/puppeteer.py`, `ufo/automator/app_apis/*` | **Equivalent** — DSH's whole stock tool catalog is native-API-first; the missing half (GUI fallback) is the row above |
| **Speculative multi-action execution** (D6/D1) | ~51% fewer LLM calls: predict N actions, validate, execute | One LLM call → N actions; lightweight UI-state validation; AIP command batching | `ufo2/overview.md` §Speculative; `documents/docs/aip/overview.md` | **Packaging gap** *(provisional)* — DSH Code Mode already amortizes one model request across many tool calls; the live-UI-state validation twist is domain-specific |
| **Continuous knowledge substrate** (D7) | Agents improve without retraining; docs + live web + own traces retrieved at inference | `vectordb/`+`rag/` vector retrieval; `learner/`+`record_processor/` turn traces into experience | `ufo2/overview.md` §Knowledge; repo packages | **Plugin opportunity** *(provisional)* — composable from `ctx.sessions` query + `ctx.storage` + a retrieval tool; DSH records D7 absent-by-design-scope |
| **Living-DAG declarative orchestration** (D8/D9) | Workflow = inspectable/editable graph that adapts mid-run instead of failing | Constellation Agent creation/editing modes; TaskStar/TaskStarLine; ConstellationEditor undo/redo | `documents/docs/galaxy/overview.md`; `galaxy/constellation/` | **Packaging gap** — DSH workflow scripts orchestrate DAG-shaped fan-out but as ephemeral code, not a persistent rewritable artifact |
| **Distributed multi-device execution fabric** (D11) | One request fans across heterogeneous owned devices (Windows/Linux/Android) with parallelism + failover | Device agent servers + ConstellationClient registry + asyncio orchestrator + safety invariants I1–I3 | `galaxy/overview.md`; `galaxy/constellation/orchestrator/` | **Core gap** — DSH is single-host per profile (E2B relocates seams to one cloud box); no multi-host/device model |
| **AIP persistent device protocol** (D10/D11) | Long-lived, resilient agent-to-agent channel: registration, task streaming, heartbeat, reconnect | 5-layer WebSocket protocol; explicitly positioned against A2A/ACP | `documents/docs/aip/overview.md`; `aip/` | **Core gap** *(provisional)* — a one-agent WebSocket channel could compose via the SDK/RPC seam; multi-device sessions/failover need core routing |
| **Capability-profile device matching** (D11/D8) | Tasks placed by OS/hardware/telemetry (GPU, load), refreshed live | AgentProfile = user config + service manifest + client telemetry | `documents/docs/aip/overview.md` | **Core gap** *(provisional)* — DSH external-harness subagent providers are config-time, no runtime capability registry seam |
| **Blackboard shared memory** (D8) | Orchestrator + workers share structured state without coupling | `Blackboard` shared space; subtask results child→host | `agent_types.md`; `infrastructure/agents/design/blackboard.md` | **Packaging gap** — `ctx.storage` domain KV + `report` channel compose this today; not packaged as an agent-shared workspace |
| **Trajectory artifacts + run metrics** (D19/D18) | Post-run audit: timeline, DAG evolution, parallelism/critical-path stats | `ufo/trajectory/`; `output.md` + `result.json` per run | `galaxy/overview.md` §Monitoring | **Equivalent** — DSH log-is-the-trace + Trajectory view + session export; UFO's DAG-evolution report is workflow-specific packaging |
| **MCP as the command substrate** (D2/D3) | Uniform tool layer local+remote; device-agent authoring template | App/OS/mobile tooling shipped as stdio & HTTP MCP servers; `creating_device_agent` tutorial | `documents/docs/mcp/`; `quick_start_mobile.md` | **Packaging gap** — DSH MCP bridge exists but opt-in, client-side, tools-only; UFO makes MCP the execution fabric |
| **Picture-in-Picture non-disruptive desktop** (D12/D13) | Agent works in a parallel virtual desktop; user keeps mouse/keyboard | Windows RDP-loopback nested virtual desktop | `ufo2/overview.md` §PiP | **Not applicable** — different category: DSH never owns the user's desktop; its sandbox/E2B isolation already separates agent effects from the user |

## 10. Absence is data: what DSH has that UFO lacks

- **No composition model:** no plugins/profiles/seams — extension is code templates ("creating AppAgent/device agent" tutorials) or adding MCP servers; no package registry/marketplace.
- **No durable, resumable sessions:** a "session" is one automation run writing log files; no event-sourced log, no fork/resume/replay, no crash-recovery invariants.
- **No permission/approval/sandbox layer:** agents act directly on the live desktop/process with no permission modes, approval waterfall, or file-effect sandbox — the safety story is PiP isolation + logs.
- **No credential hygiene:** LLM/API keys live in plain config YAML (`config/ufo/agents.yaml`); no reference-based resolution or wire-hygiene seam.
- **No skills/instructions system, no goal/scheduling model, no token metering/compaction** (context control is prompt construction + `max_steps`/`max_subtasks` caps).
- **Single-LLM-provider-style config per agent role** with per-call retries but no settings hot-reload, no usage-accurate stream accounting, no KV-cache discipline.

DSH-side asymmetry: DSH has **no** browser/computer control (D12 recorded absence — UFO's home turf), no mobile client, no multi-node story, no execution-trace→learning loop (D7 absent by scope).

## 11. Uncertainties / open questions

1. **PiP implementation status** — docs present Picture-in-Picture as implemented (RDP loopback); the GitHub README capability table says "(coming soon)"; a grep for `pip_desktop|picture_in_picture|PictureInPicture` at `cd9bfdd` found nothing. Unresolved.
2. **Speculative executor in source** — docs describe it; no `Speculative*`/`multi_action` symbol surfaced in a quick grep; mechanism detail is docs-level only.
3. **Docs-vs-source on Office APIs** — docs name Outlook/`win32com`; in-tree `app_apis/` clients are excel/word/powerpoint/shell/web. Outlook binding may live elsewhere or be aspirational.
4. **FSM enums** — 7/6/3 state counts are docs-attested; individual state names (beyond Linux/Mobile CONTINUE/FINISH/FAIL) not verified in source.
5. **UFO³ paper** (arXiv:2511.11332) — only abstract + docs read; "formal verification" / invariants I1–I3 and the "formally verified correctness" release claim taken from first-party docs, not checked against the paper's proofs.
6. **Knowledge-substrate internals** — offline/online split, index formats, `learner/`↔`record_processor/` dataflow unverified; "Bing search" integration mechanism not inspected.
7. **Claimed numbers** — "10%+ over SOTA CUAs", "51% fewer LLM calls" are authors' claims (docs + papers), not independently validated; WAA/OSWorld benchmark pages not re-run.
8. **Galaxy webui** (`galaxy/webui`, `documents/docs/galaxy/webui.md`) — visualization/monitoring scope not inspected.
