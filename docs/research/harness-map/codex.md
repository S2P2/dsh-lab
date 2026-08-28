# OpenAI Codex: architecture & distinctive capabilities (vs DSH baseline)

**Baseline for: Agent Harness Capability Map (profile #17 of 18)**

- **Researched:** 2026-08-30 (in-session; three delegated runs failed before reporting, so the parent session completed the profile directly).
- **Repo:** `github.com/openai/codex`, Apache-2.0, pinned **`6be2a6ca952ac9f70676ce4dd07fda27175aa9dd`**; shallow sparse clone of `codex-rs/` and `docs/`. All unqualified paths below are at that SHA.
- **First-party docs:** `https://developers.openai.com/codex/` and linked security/non-interactive/config pages, accessed 2026-08-30; repo `docs/*.md` redirects to these pages. Source beats product copy where both cover the same mechanism.
- **DSH comparison:** `dsh-baseline.md` pinned `b150a55`; §7 taxonomy D1–D20, capability names verbatim.

**Verdict.** Codex is no longer merely a Rust terminal loop: it is an open agent platform whose `codex-core` is shared by a TUI, non-interactive runner, MCP server, VS Code-facing **app-server**, remote exec-server, and hosted/mobile control surfaces. Its architecture increasingly converges on DSH — append-only canonical history, derived views, Code Mode, skills, hooks, goals, subagents, typed RPC, OTel, and extension crates — while making different boundary choices: a stable product protocol (`Thread → Turn → Item`) rather than Cordis runtime composition; OS-enforced filesystem **and network** policy plus automated Guardian review rather than DSH's file-effect sandbox + one-shot approval; and an OpenAI-centered model plane rather than a first-class multi-provider kernel. The current repository also ships two capabilities DSH explicitly lacks: a production two-phase cross-session memory pipeline and a live remote execution/control fabric. Most strikingly, Codex's opt-in rollout trace independently reproduces DSH's “raw log first, derive model-visible state later” doctrine, but extends the reducer into a semantic graph spanning inference, tools, code cells, terminals, and subagent edges.

## 1. Positioning & repository shape

- `codex-rs/core/README.md` defines `codex-core` as business logic shared by Rust UIs; the workspace contains dedicated crates for `tui`, `exec`, `app-server`, `app-server-protocol`, `mcp-server`, `exec-server`, `thread-store`, `rollout`, `rollout-trace`, `memories`, `otel`, `hooks`, `skills`, `plugin`, `core-plugins`, Code Mode, agent roles/graph storage, remote/cloud clients, and OS sandboxes (`Cargo.toml` workspace; crate manifests).
- This is a **deep modular monolith**, not “everything is a plugin”: core capabilities are Rust crates wired by the product; extension packages exist, but neither users nor a config row can replace the central turn loop the way a DSH loop plugin can.
- Product surfaces share one protocol/runtime: interactive TUI; `codex exec` for headless/CI; `codex app-server` for rich clients; `codex mcp-server`; and the VS Code extension cited in `app-server/README.md:1-4`.

## 2. Runtime and tool loop

- App-server exposes the canonical public model: **Thread** (conversation), **Turn**, **Item** (user input, reasoning, message, shell command, file edit, etc.); `thread/start|resume|fork`, `turn/start|steer|interrupt`, and item/turn notifications drive the loop (`app-server/README.md:66-83`).
- The core preserves incremental model context: repo `AGENTS.md` requires no history rewrite, bounded injected items, and cache-stable context; this matches DSH's request-header/KV-cache discipline even though enforcement lives in code-review rules plus concrete context structs.
- Built-ins include shell/PTY, `apply_patch`, file search/read/write, web search, image input, MCP tools, skills, review, multi-agent tools, and experimental dynamic tools; `command/exec` can run a utility under the server sandbox without opening a thread (`app-server/README.md:212-245`).
- **Code Mode is first-party convergence.** Crates `code-mode`, `code-mode-host`, `code-mode-runtime`, and `code-mode-protocol` execute model-authored programs that can make nested guarded tool calls; rollout tracing explicitly distinguishes code cells from their nested tool and terminal operations (`rollout-trace/README.md:24-37,127-170`).
- App-server supports deferred dynamic tools/namespaces at thread start; MCP's extension profile is fixed for a loaded thread and inherited by subagents, preserving a stable per-session tool contract (`app-server/README.md:91-117,327-380`).

## 3. Sandbox, permissions, and approvals

- **OS confinement is a primary runtime boundary.** macOS uses Seatbelt; Linux selects Landlock for legacy-equivalent policy and bubblewrap for exact split policies; Windows uses elevated and restricted-token backends, failing closed when requested carve-outs cannot be represented (`core/README.md:19-92`).
- Current split policies express exact read/write/none roots, reopened descendants, and network policy. The app server also exposes managed domain/socket constraints, managed-only domain mode, and Browser/Computer Use policy (`app-server/README.md:290-296`). This is materially broader than DSH's filesystem-only effect sandbox.
- Approval is separately configurable (`on-request`, `unless-trusted`, `never`, granular profiles) and can include an automated approvals reviewer/Guardian; denied Guardian actions have an explicit manual override API (`protocol`, `codex-mcp`, `app-server/README.md:206,248`).
- Permission requirements and MDM can constrain allowed approval policies, sandbox modes, named profiles, web-search modes, hooks, remote control, browser/computer use, models, and network policy. DSH has stronger one-shot/frozen-argument invariants; Codex has a broader centrally-managed policy plane.
- User `!` shell commands are intentionally outside the agent sandbox and documented as full-access (`app-server/README.md:205`): user agency and model agency are distinct trust domains.

## 4. Sessions, state, and memory

- `ThreadStore` is the storage boundary. `append_items` writes raw canonical history; `LiveThread` owns active persistence; local storage combines append-only rollout JSONL with SQLite query metadata (`thread-store/README.md:1-34`). This is close to DSH's log-first architecture, though Codex metadata has explicit mutable APIs rather than being solely a projection.
- Durable operations include list/search/archive/delete, resume, fork through a chosen turn, revert to a prior turn prefix, pagination, projects/sections, ephemeral threads, parent/child filtering, and one-writer ownership for a loaded paginated thread (`app-server/README.md:161-211,395-407`). File changes are not reverted by `thread/revert`.
- **Cross-session memory is shipped, not aspirational.** On eligible root-session startup, Phase 1 leases recent rollouts, model-extracts structured memories in bounded parallel jobs, redacts secrets, and stores results in SQLite. Phase 2 takes a global lease, ranks selected memories, writes git-baselined artifacts under `~/.codex/memories`, computes a workspace diff, and runs a no-network/no-approval consolidation subagent (`memories/README.md:29-157`).
- Memory mode is persisted per thread; app-server can reset the memory workspace (`app-server/README.md:183-184`). This is a **Core gap** under DSH's explicit D7 absence, even though Codex proves the mechanism needs no embedding database.
- A single persisted thread goal and FIFO queued turns are app-server primitives (`thread/goal/*`, `thread/queue/*`; lines 185-196), strongly converging on DSH goals/background continuation.

## 5. Multi-agent and repo workflows

- Child agents are real threads with `parentThreadId`; parents spawn/message/follow-up/close children, and rollout tracing records task/result/close edges in one root graph (`rollout-trace/README.md:172-197`). Parent-owned V2 children reject direct mutation and are resumed through their loaded owner (`app-server/README.md:395-397`).
- AGENTS.md and filesystem skills are first-class; extra skill roots can be added at runtime. Hooks are layered config and can be locked to managed-only mode (`docs/config.md:9-15`; app-server `skills/list`, `hooks/list`).
- Review is a distinct inline or detached thread operation, not just a prompt convention (`review/start`; `app-server/README.md:223`).
- Repository workflow support includes project roots, git metadata, fork/revert, review, non-interactive JSON output, and cloud-task clients. Hosted asynchronous tasks are product infrastructure and are not treated as evidence of a local cron scheduler.

## 6. Model/provider plane

- Codex is OpenAI-centered: ChatGPT login/API key, an authoritative model catalog, reasoning effort/service tiers, Responses API semantics, and Codex-specialized models are first-class. Local Ollama/LM Studio and configurable OpenAI-compatible endpoints exist, but the runtime is not a neutral provider registry comparable to DSH's adapter seam (`ollama`, `lmstudio`, `model-provider*`, `chatgpt`, `models-manager` crates).
- App-server can list models/capabilities, switch some settings mid-turn experimentally, and restore persisted model/reasoning settings on resume (`app-server/README.md:214,245-247,395-407`).
- **Relationship:** OpenAI/Codex integration is Equivalent in role; general provider portability is a reverse gap on Codex's side, not a DSH gap.

## 7. Client/server, remote execution, and control

- `codex app-server` is a versioned bidirectional JSON-RPC 2.0 boundary over JSONL stdio, experimental WebSocket, or local Unix-socket WebSocket. It generates matching TypeScript and JSON Schemas, uses bounded queues/backpressure, and exposes health endpoints (`app-server/README.md:20-64`).
- Clients initialize with capabilities, receive streamed item/turn notifications, and can independently subscribe/unsubscribe. This is a stronger public product protocol than DSH's private typed RPC gateway, but equivalent in architectural role.
- `codex exec-server` separates process/filesystem execution from the harness. Remote mode registers an environment, uses a Noise-encrypted rendezvous WebSocket with segmentation, ack/retry/resume, and exposes process/PTY/filesystem RPC; a forwarder remains payload-blind (`exec-server/README.md:1-137`).
- App-server can select sticky local/remote environments per thread and observe connection status. Separate remote-control APIs pair/revoke controller devices and relay a local app-server to remote/mobile clients (`app-server/README.md:249-253,269-276`). This live execution/control fabric is a **Core gap** versus DSH's SSH launch + isolated cloud-sandbox providers.

## 8. Extensibility and MCP

- Codex now has local/remote plugin marketplaces, search/install/uninstall/share, bundled skills/hooks/apps/MCP servers, admin availability policy, and an official curated catalog (`app-server/README.md:255-296`). This is a **Packaging gap** relative to DSH's npm/topic-based ecosystem, not evidence that Codex has DSH's runtime-composable kernel.
- MCP is full-surface: OAuth, tools, resources/templates, elicitation/forms, MCP Apps UI extension negotiation, direct resource/tool calls, event subscriptions, and status inventory. DSH's dormant bridge is tools-first; Resources/Prompts/UI/elicitation are a **Plugin opportunity** at D2/D3.
- Lifecycle hooks can be command handlers or MCP-tool handlers and can be centrally locked down; their role maps to DSH typed event interception, while their filesystem configuration UX is a Packaging gap.
- Codex can detect/import external-agent config, histories, memory, sessions, plugins, skills, and connectors (`externalAgentConfig/*`; lines 291-293): cross-harness migration is a Plugin opportunity for DSH.

## 9. Observability and recovery

- `codex-otel` exports logs, traces, metrics, W3C context, and session business events over OTLP HTTP/gRPC with deterministic shutdown (`otel/README.md`). **Equivalent** to DSH OTel in role.
- Normal rollouts are durable session evidence. Separately, opt-in `CODEX_ROLLOUT_TRACE_ROOT` captures ordered raw events + payloads, then an offline deterministic reducer derives a semantic graph of model-visible conversation and runtime objects. It is local-only and explicitly “observe first, interpret later” (`rollout-trace/README.md:1-37,94-125`).
- This is the strongest independent validation of DSH's log/projection thesis in the cohort; Codex additionally preserves raw-vs-visible distinctions that explain Code Mode and multi-agent information flow.

## 10. D1–D20 capability comparison

| # | Canonical dimension | Codex capability / mechanism | DSH relationship |
|---|---|---|---|
| D1 | Agent/runtime architecture | `codex-core`; Thread→Turn→Item; canonical append then projection | **Equivalent** in log/loop role; swappable loop is DSH-only |
| D2 | Extension/plugin architecture | Rust extension crates; plugin bundles/marketplaces; hooks | **Packaging gap** (marketplace); runtime composition remains DSH-distinctive |
| D3 | Tools/MCP/protocols | guarded stock tools, Code Mode, full MCP client + MCP server, app-server | **Equivalent** for guarded tools/Code Mode; **Plugin opportunity** for full MCP surface |
| D4 | Skills/instructions | AGENTS.md, skills roots, hooks, Plan/collaboration modes | **Equivalent** |
| D5 | Models/provider routing | OpenAI catalog + local/OpenAI-compatible options | **Equivalent** for OpenAI role; broad portability is a reverse gap |
| D6 | Context management | incremental bounded context, compaction, rollout budgets, cache discipline | **Equivalent** |
| D7 | Memory/learning | leased two-phase extraction→global git-workspace consolidation | **Core gap** (DSH explicitly has no memory pipeline) |
| D8 | Multi-agent/subagents | parent-owned child threads, messaging, result/close edges, reviews | **Equivalent**; proactive V2 orchestration is a **Packaging gap** *(provisional)* |
| D9 | Scheduling/background work | persisted goals + queued turns; hosted cloud tasks | Goals **Equivalent**; local cron absent; hosted tasks **Not applicable** |
| D10 | Channels/messaging | TUI, exec, app-server, editor, remote/mobile control | **Equivalent** core surfaces; mobile/voice productization is **Core gap** *(provisional)* |
| D11 | Remote/mobile/nodes | Noise-relayed exec-server environments + paired remote controllers | **Core gap** — live remote environment/control substrate |
| D12 | Computer/browser control | managed Browser/Computer Use policy and app surfaces | **Core gap** *(provisional: execution source not deeply traced)* |
| D13 | Sandbox/permissions/security | Seatbelt/Landlock/bwrap/Windows; split fs + network; Guardian review | **Core gap** for domain/socket policy; reviewer is **Plugin opportunity** |
| D14 | Credentials/secrets | ChatGPT/API-key login, keyring/auth flows, managed policy | **Equivalent** |
| D15 | Persistence/sessions/state | JSONL canonical history + SQLite metadata, fork/resume/revert/projects | **Equivalent**; one-writer thread leases are **Packaging gap** |
| D16 | UI/client-server separation | generated-schema JSON-RPC app-server; TUI/editor/mobile clients | **Equivalent** in role; public client SDK is **Packaging gap** |
| D17 | Deployment/VPS/cloud | native binaries, exec-server, hosted tasks | Native distribution **Packaging gap**; SaaS control plane **Not applicable** |
| D18 | Artifacts/documents/apps | MCP Apps, connectors, image/files, plugin UI surfaces | **Plugin opportunity** for mini-app/UI protocol |
| D19 | Observability/recovery | rollout log, OTel, local raw trace→semantic graph, goals | **Equivalent**; trace graph is a **Packaging gap** enrichment |
| D20 | Resource usage/scalability | token/usage streams, bounded queues, rollout budgets, backpressure | **Equivalent**; remote multi-host execution is covered under D11 |

## 11. Cross-cutting observations for synthesis

1. **Convergence is now concrete:** Codex independently ships DSH-shaped Code Mode, goals, append-first persistence, derived model-visible views, typed client protocol, extension crates, and background children.
2. **The safety frontier moved from filesystem to policy topology:** Codex combines exact filesystem carve-outs, network domain/socket constraints, enterprise requirements, automated review, and separate user-vs-model execution paths. DSH's one-shot/freshness semantics remain stronger in a narrower boundary.
3. **Log doctrines differ by purpose:** DSH's event log is the product state; Codex's rollout is canonical conversation history plus mutable metadata, while its richer raw event log is opt-in diagnostics. The semantic trace reducer is nevertheless the closest cohort analogue to `deriveMessages` plus projections.
4. **Protocol-first vs composition-first:** Codex standardizes an enormous Thread/Turn/Item RPC surface; DSH standardizes runtime seams. OIX/Workstation's fork demonstrates that Codex's protocol is already an ecosystem substrate.

## 12. Uncertainties / open questions

- Main is moving daily and contains many under-development/experimental app-server methods; re-pin before external quotation and label stable vs experimental rows in synthesis.
- Browser/Computer Use policy is source-visible, but this pass did not trace the complete local execution path; D12 stays provisional.
- Cloud tasks, remote plugin service, and mobile control mix open client code with hosted backends; backend mechanics and scaling claims are out of scope.
- The broad app-server README is authoritative at the pinned SHA but documents features at varied maturity; marketplace and remote-control APIs explicitly warn some clients not to rely on them yet.
- No benchmark or fleet-scale performance claim was accepted; crate/protocol existence establishes capability, not production adoption.
