# Agent Harness Capability Map — consolidated across the cohort

**Baseline for: [Wayfinder: Agent harness capability map](https://github.com/S2P2/dsh-lab/issues/11) · synthesis of [#30](https://github.com/S2P2/dsh-lab/issues/30)**

- **Compiled:** 2026-08-30, from 18 completed profiles (17 external harnesses + the DSH baseline) and 2 verification follow-ups, every one pinned to a primary-source SHA (index in §7). Per-cell authority lives in the profile notes; this map **deduplicates, normalizes disagreements, and consolidates the DSH opportunity inventory**.
- **Vocabulary:** *Capability* = user/agent-visible behavior, independent of mechanism. Classifications vs DSH: **Equivalent** · **Packaging gap** (capability reachable by composing/configuring shipped DSH pieces, but nobody ships the package) · **Plugin opportunity** (needs new plugin code at an existing seam — seam named) · **Core gap** (needs host/runtime substrate DSH lacks) · **Not applicable** (philosophy/SaaS contrast, not a gap).
- **Grid notation (§2):** ✓ shipped/strong · ◐ partial / provisional / in-flight · ✗ absent. Cohort columns are as-of each profile's pin date (§7); fast movers are flagged in §6.

## 1. What the cohort is

Seventeen systems, deliberately heterogeneous: productized personal assistants (OpenClaw, Hermes, nanobot), governed desktop coworkers (OpenWorker, Eigent), research fleets (UFO³, NemoClaw+OpenShell), multi-repo platforms (OpenHands), server-first coding agents (OpenCode), closed-source standard-setters (Claude Code), open platforms converging on DSH's shape (Codex, Pi mid-flight), editor-natives (Cline, Goose), a multi-user cloud OS (Cloudflare OS), and a Rust Codex fork (OIX/Workstation). No cohort member is a Cordis-style runtime-composition kernel; **DSH's everything-is-a-plugin tree with typed seams is architecturally unique in this set**, with Pi's in-flight `AgentHarness` rewrite the closest independent convergence.

## 2. Consolidated dimension grid

Landscape column names the strongest shippers (not exhaustive); full per-harness calls are in each profile's D-table.

| Dim | DSH position (baseline @ `b150a55`) | Cohort landscape | Normalized DSH relationship |
|---|---|---|---|
| **D1 runtime** | Event-sourced log + swappable loop driver | Log-is-truth independently re-derived by OpenHands (tree log), Codex (rollout + trace reducer), Pi (in-flight record log); nanobot artifacts-as-audit; most others in-memory buses | Log/loop doctrine **Equivalent** at the leaders; swappable loop remains DSH-distinctive |
| **D2 extension** | Config-layered composition, capability seams, in-session dynamic plugins | CC filesystem-config contract; Codex extension crates + marketplaces; goose MCP-as-fabric; nanobot/Agent-Zero directory scanning; Cline sandboxed plugin subprocesses | Runtime composition = DSH lead. Marketplaces/format adoption = **Packaging gap**; sandboxed plugin subprocesses = **Plugin opportunity** (`ctx.subprocess`+`ctx.fs`); directory-scan = **Not applicable** (philosophy) |
| **D3 tools/MCP** | Guarded pipeline, Code Mode, tools-first MCP bridge, ACP automation subset, external-harness subagents | Full MCP client surface (goose, Codex, Cline, OIX); MCP servers as extension fabric (goose, UFO action layer); LSP depth (OpenCode, Cline) | Guarded tools/Code Mode **Equivalent** (Codex/OpenCode independent convergence); MCP resources/prompts/elicitation/sampling/apps = **Plugin opportunity** (`dsh-mcp-client` + typed events); LSP depth = **Packaging gap** |
| **D4 skills/instructions** | Filesystem skills, progressive disclosure, AGENTS.md, plan mode | CC SKILL.md is the de-facto standard (OpenHands, OIX, agentskills.io adopters with field supersets) | **Equivalent**, format-compat = **Packaging gap** |
| **D5 models/providers** | Multi-provider adapter registry (incl. `dsh-llm-pi-ai` wrapping pi-ai) | pi-ai ~34 providers; models.dev catalog (OpenCode); RouterLLM mid-conversation switch (OpenHands); OIX harness emulation per provider family; subscription/OAuth providers (Cline, goose, CC) | Registry **Equivalent**; catalogs w/ cost+limits = **Plugin opportunity** (`ctx.llm`); mid-conversation router = **Plugin opportunity**; harness emulation = **Plugin opportunity** (preset + `ctx.llm`); subscription OAuth flows = **Packaging gap** |
| **D6 context** | Pressure compaction, pre-pruning, spill, epochs | Codex rollout budgets + bounded-items rules ≈ DSH KV-cache discipline; Pi compaction-by-extension; OpenHands/Cline compaction seams | **Equivalent** at the leaders |
| **D7 memory** | **Absent by scope** | Shipped by 8/17: CC auto-memory, Codex two-phase leased pipeline (git-baselined workspace), OpenClaw dreaming, Hermes consent-gated files, nanobot Consolidator→Dream, Agent Zero FAISS, OIX opt-in, Goose ◐ chatrecall | **Core gap** — the cohort's most consistent one; no embedding substrate or memory lifecycle in DSH |
| **D8 multi-agent** | One-shot delegation, background children, report channel, Ralph, workflow scripts, persistent teams (mechanism) | Cline ~17 `team_*` tools; Eigent Workforce w/ editable tree; UFO living-DAG multi-device; Codex parent-owned child threads; OpenHands leases | Mechanism **Equivalent** (Codex converges strongly); teams/workforce **productization** = **Packaging gap**; multi-device DAG fabric = **Core gap** |
| **D9 scheduling** | Session-local reminders (opt-in), no cron/wall-clock by design | Always-on schedulers shipped: OpenClaw, Hermes, nanobot, Agent Zero, Cline hub cron/agenda, OpenHands automation; goose in-process cron recipes | Split normalization: in-process/session-scoped scheduling = **Plugin opportunity** (goose proves it); unattended always-on daemon + calendar semantics = **Core gap** (no always-on host) |
| **D10 channels** | Web UI, headless, ACP automation-subset, SDK/RPC; no chat platforms | Chat connectors shipped by 7: OpenClaw ~30, Hermes 20+, nanobot 17, Cline 5+, Goose Telegram, OpenHands Slack/GH/Linear, Agent Zero TG/WA/email | Split normalization: channel presence/delivery as a **product capability** = **Core gap** (resolves the OpenClaw-vs-Agent-Zero divergence); single-connector prototype via `ctx.webServer` webhook = **Plugin opportunity** — both recorded |
| **D11 remote/mobile** | SSH launch, LAN fence, cloud sandbox providers | Live remote fabrics: Codex Noise-relayed exec-server + paired remote control; OpenClaw paired nodes; OpenCode session warp + remote workspaces; CC `--cloud`/`--teleport`; Cline hub attach/detach | **Core gap** — live session takeover/relay/multi-client attach needs a host substrate DSH lacks |
| **D12 computer/browser** | Absent by design (web fetch shipped-disabled) | UFO (UIA/Win32 + MCP action servers), Agent Zero (container GUI + Patchright), Eigent (CDP pool, persistent login), OIX overlay CUA; CC provisional; **Cline stubbed out mid-migration** (counter-signal) | Split: browser automation via MCP/tools = **Plugin opportunity** (UFO ships the action layer as MCP servers); interactive desktop/screen substrate = **Core gap** |
| **D13 sandbox/security** | File-effect sandbox, OS runners, one-shot approval, freshness guards | Network-domain/socket policy: Codex (managed domains/sockets), OIX (network globs), NemoClaw (L7 egress proxy + custody); detection stacks: goose LLM judge+adversary, CC classifier auto-mode, OpenHands risk-ensemble, Codex Guardian | Filesystem confinement **Equivalent** (NemoClaw strongest); network-egress policy = **Core gap**; LLM review/approval layer = **Plugin opportunity** (`tools/pre-execute` + `ctx.approval`); per-tool policy data = **Plugin opportunity** |
| **D14 credentials** | Reference-based creds, interactive auth, wire hygiene | Keyring (goose), subscription OAuth (Cline/CC/goose), gateway custody (NemoClaw) | **Equivalent** core; keyring/OAuth-provider packaging = **Packaging gap** |
| **D15 persistence** | Log backends, KV, projections, fork/resume | Codex JSONL+SQLite w/ one-writer leases; OpenCode snapshots/revert; Pi in-place session tree + CBOR leases; Cline git-stash checkpoints | **Equivalent** core; checkpoints/rollback+snapshots = **Plugin opportunity** (`fs/*` events + projections; shell-effect caveat); one-writer leases = **Packaging gap** |
| **D16 UI/client-server** | Loopback-first web, typed gateway, browser plugins, HMR, slots | Codex generated-schema app-server; OpenCode public OpenAPI + every-surface-is-client; Cline gRPC proto periphery + hub; CC multi-surface continuity | **Equivalent** in role; public generated client SDK = **Packaging gap**; UI-slot extensibility = DSH lead (Cline absent, CC none) |
| **D17 deployment** | npm-first, profiles, SSH/VPS story, local-first telemetry | Native binaries (OpenCode, Codex), desktop packaging (Eigent/OpenCode/Cline), managed MDM (OpenCode, Codex), SaaS control planes (CC/Codex/Eigent) | Desktop/native packaging = **Packaging gap**; SaaS control planes = **Not applicable** |
| **D18 artifacts/apps** | Image attachments, deliverables, export, spill; no canvas/mini-apps | MCP Apps UI (Codex/goose `io.modelcontextprotocol/ui`), goose_apps, CC artifacts, chat-app surfaces | **Plugin opportunity** (typed-events + webServer slot); mini-app productization = **Packaging gap** |
| **D19 observability** | Log-is-the-trace, OTel, crash recovery, goal model | Codex raw-trace→semantic-graph reducer (opt-in diagnostic); OpenHands rrweb; Pi evals; OTel near-universal | **Equivalent**; trace-graph reducer = **Packaging gap** enrichment; goal model converging (nanobot near-tool-for-tool, Codex `thread/goal`) |
| **D20 resources** | Token metering, pressure projections, cache discipline, bounds | Codex bounded queues/backpressure + rollout budgets; OpenCode multi-tenant instances | **Equivalent**; multi-host scaling folds into D11 core gap |

## 3. DSH opportunity inventory (deduplicated, evidence-backed)

Ordered by cohort consensus. Each record: capability — sources — classification — boundary — why it merits investigation.

### Core gaps (host substrate required)

1. **Cross-session memory pipeline** — CC, Codex, OpenClaw, Hermes, nanobot, Agent Zero, OIX (7 independent implementations; Codex's two-phase lease + git-baselined workspace is the reference mechanism; nanobot proves files+bus suffices without embeddings). Why: the single most requested absent capability; every converged harness ships one.
2. **Network-egress policy (domain/socket) in the sandbox** — Codex, OIX, NemoClaw. Why: filesystem-only confinement is DSH's narrow waist; all three treat network as a first-class policy surface. Extends D13 runners, not plugins.
3. **Always-on automation host (cron/calendar + channel presence)** — OpenClaw, Hermes, nanobot, Agent Zero, Cline, OpenHands, Goose(in-process counterexample). Why: DSH's reminders are session-local by design; unattended operation needs a daemon-lifecycle substrate. (Session-scoped scheduling alone remains plugin territory — see #8.)
4. **Live remote session fabric** (relay/attach/warp/paired nodes) — Codex, OpenCode, OpenClaw, CC, Cline. Why: multi-client attach and cross-host session takeover break single-host log assumptions; needs host-level session ownership model.
5. **Interactive desktop/computer-use substrate** — UFO, Agent Zero, Eigent, OIX; Cline's mid-migration stub is the counter-signal. Why: media/input injection is below DSH's tool pipeline; browser-only variant is plugin-reachable (#9).
6. **Multi-device orchestration fabric** — UFO Galaxy/AIP, Cloudflare OS object-capability mediation, OpenHands cross-instance leases. Why: DSH agents are single-host; device graphs and mediated resource capabilities have no seam.

### Plugin opportunities (existing seam, new code)

7. **LLM-assisted approval/review layer** — goose (judge + adversary), CC (classifier auto-mode), OpenHands (risk-prediction ensemble), Codex (Guardian), OpenCode (doom-loop). Boundary: `tools/pre-execute` waterfall + `ctx.approval`. Why: five independent stacks converge on detection-in-front-of-approval; zero core change needed in DSH.
8. **In-process scheduling/cron recipes** — goose `tokio_cron_scheduler` recipes, Cline agenda queue mechanics. Boundary: `dsh-schedule`-style plugin + `agent/*` events; stays session-scoped (the always-on half is core gap #3).
9. **Browser automation tool** — Agent Zero (DOM refs, BYO browser), UFO (action layer ships as MCP servers). Boundary: `ctx.tools` + `ctx.subprocess` + `ctx.attachments`, mounting UFO-style MCP action servers through the existing bridge. Why: lets DSH reach the web without a desktop substrate (core gap #5 stays separate).
10. **Full MCP client surface** — goose, Codex, Cline, OIX (resources, prompts, elicitation, sampling, MCP Apps UI). Boundary: `dsh-mcp-client` + typed events. Why: DSH's bridge is deliberately tools-first; the cohort treats the rest of MCP as table stakes.
11. **Checkpoints / per-step snapshots / rollback** — CC, OpenCode, Cline, Pi. Boundary: `fs/*` events + session projections. Caveat: shell-command effects bypass `fs/write-intent`, so snapshot completeness needs the guarded pipeline — record as open question.
12. **Model catalogs + mid-conversation routing + harness emulation** — OpenCode (models.dev), goose (registry/cost), OpenHands (RouterLLM/`switch_llm`), OIX (provider→harness auto-mapping). Boundary: `ctx.llm` + presets. Why: routing intelligence above the adapter registry is pure plugin layer.
13. **Cross-harness import/migration** — goose (CC/Codex/Pi session import), Codex (`externalAgentConfig`), OIX (portability-as-constraint). Boundary: sessions backend + embedding SDK.
14. **Sandboxed plugin subprocesses / tool-routing containers** — Cline (plugin sandboxing), Pi (Gondolin). Boundary: `ctx.subprocess` + `ctx.fs`.
15. **Stuck-detection & nudge** — OpenHands, OpenCode. Boundary: `agent/*` events.
16. **MCP Apps / mini-app UI surfaces** — Codex, goose (`goose_apps`, `io.modelcontextprotocol/ui`). Boundary: typed events + `ctx.webServer` slot.

### Packaging gaps (composition exists, nobody ships the package)

17. **Plugin marketplaces & format adoption** — CC marketplace layout (de-facto), Codex curated+remote marketplaces, goose/ClawHub; DSH has a GitHub topic index only.
18. **Desktop/native distribution** — Eigent Electron, Cline Tauri, OpenCode/Codex native binaries; DSH documents an Electron path, ships none.
19. **Public generated client SDK** — Codex `generate-ts`/schema, OpenCode OpenAPI 3.1 + generated SDKs; DSH's typed gateway is private.
20. **Stock consumer toolkit breadth & personas** — Eigent ~40 toolkits/8 personas, OpenCode/OpenHands agent presets, nanobot persona files; all composable in DSH today, none composed.
21. **Subscription/OAuth provider onboarding + keyring** — Cline, CC, goose, OpenCode.
22. **Trace/debug graph tooling** — Codex raw-trace→semantic-graph reducer as a diagnostic product; DSH has the log, not the reducer UX.

### Not applicable (contrasts, not gaps)

SaaS credits/billing backends (Eigent, CC cloud, Codex cloud tasks) · research protocol stacks (UFO AIP) · framework doctrines (OpenCode Effect vs Cordis) · fork-and-white-label distribution (goose `CUSTOM_DISTROS`) · directory-scan extension (nanobot, Agent Zero — a philosophy, not a missing seam) · Memory Bank convention (Cline).

## 4. Cross-cutting patterns

- **Independent convergence on DSH's bets** — log-is-truth (OpenHands, Codex, Pi in-flight), Code Mode (Codex, OpenCode, OIX), bounded-context/KV-cache discipline (Codex's code-review rules mirror DSH's epochs), goals (nanobot nearly tool-for-tool, Codex `thread/goal`, CC), typed client protocols everywhere. The bets are winning; the differentiator is *composition* vs *productization*.
- **Safety doctrine spectrum** — DSH/NemoClaw/Codex confine (OS-level); goose/CC/OpenCode detect (LLM review stacks); OpenHands inverts the container. DSH's one-shot/freshness semantics remain the strictest in-process invariants in the cohort.
- **Editor↔runtime separation spectrum** — Cline (gRPC proto periphery + detached hub, strongest) > Codex app-server > OpenCode every-surface-is-client > DSH host/browser split > CC monolith-with-SDK. DSH is mid-spectrum; its ACP is automation-only.
- **Format-adoption graph** — Claude Code is the source node (SKILL.md, hooks vocabulary, marketplace layout → OpenHands, OIX, agentskills.io adopters with field-superset variance). DSH skills are compatible-adjacent; formal CC-format parity is cheap insurance.
- **Dependency edges into DSH** — `dsh-llm-pi-ai` wraps pi-ai (pinned 0.82.1 vs 0.84.3 HEAD at profiling); DSH's web-search-router already routes Codex models. The map is not cycle-free: DSH depends on two cohort members' surfaces.
- **Minimalism reveal** (nanobot) — channels+memory+cron+persona are "files + one bus" in the minimal harnesses; the expensive part in DSH terms is not the capability but the always-on host (core gap #3) — that asymmetry should shape any DSH roadmap ordering.
- **Docs-vs-source drift is endemic** — Eigent workflow canvas, Cline checkpoints, Codex README-vs-SDK serialization, UFO PiP: every profile that checked found drift; the map always cites the pinned tree, not the docs page.

## 5. Disagreements normalized

| Divergence | Profiles | Normalized call |
|---|---|---|
| D10 chat channels: Core gap vs Plugin opportunity | OpenClaw (core) vs Agent Zero (plugin, prov.) | Both stand at different layers: product capability (presence/delivery/always-on) = **Core gap**; single-connector webhook prototype via `ctx.webServer` = **Plugin opportunity** |
| D9 cron: Core gap vs Plugin opportunity | most vs goose | Split: in-process/session-scoped = **Plugin**; unattended always-on = **Core** |
| D12 computer use: Core vs Plugin | CC/Eigent (core) vs UFO (plugin via MCP) | Split: browser-via-MCP = **Plugin**; interactive desktop substrate = **Core**; Cline's stub is a recorded counter-signal |
| Checkpoints: Plugin vs Core | OpenCode/Pi (plugin) vs Cline (torn) | **Plugin opportunity**, with the shell-effects/completeness caveat carried as an open question |
| Teams: Equivalent vs Core | baseline D8 (mechanism present) vs Cline (torn, "unmounted") | Mechanism **Equivalent**; productized team surface = **Packaging gap** |
| Directory-scan extension: Core gap vs philosophy | nanobot profile (provisional core) | Reclassified **Not applicable** (contrast row): foreign to Cordis by design, not a missing substrate |

## 6. Remaining fog / deep dives before map destination

1. **OpenClaw fleet/mantis/workboard machinery** — title-verified only; possible unprofiled multi-agent capability cluster. Follow-up ticket charted on the map.
2. **DSH TUI existence** — bundle-patch comments reference "the TUI"; no TUI ships in `apps/`. Settle before asserting DSH client surfaces (baseline discrepancy carried).
3. **Event dispatch-mode vocabulary** — cordis-primer `parallel` vs develop docs `bail`; verify against vendor Cordis before grid uses event modes.
4. **Shipped schedule-enabled bundle** — product page advertises scheduling; no shipped bundle mounts `dsh-schedule`.
5. **Re-pin before external quotation** — fast movers: Codex (daily), OpenCode (V2 rewrite + org rename), Cline (mid-migration), OpenClaw channels, Hermes (~daily), OpenWorker (beta), Cloudflare OS (early access; workerd self-host "COMING SOON" would revisit its D11/D17 calls).
6. **Checkpoints completeness** — whether a projection-based checkpoint can be sound given shell effects bypass `fs/write-intent`.
7. **DSH webServer security posture** — plain HTTP, no origin policy: constrains the D10 plugin-prototype path; needs a stance before any channel connector ticket.

## 7. Profile index (authoritative per-cell source)

| Profile | Note | Pin |
|---|---|---|
| DSH baseline | `dsh-baseline.md` | `b150a55` (page live-fetched 2026-08-28) |
| OpenClaw | `openclaw.md` | `d62f0b8` |
| Hermes Agent | `hermes-agent.md` | `1ae2c2b` |
| OpenWorker | `openworker.md` | `86c57f0` |
| Cloudflare OS | `cloudflare-os.md` | `1411714` |
| NemoClaw + OpenShell | `nemoclaw-openshell.md` | `cac239bc` / `9f88f8ff` |
| Agent Zero | `agent-zero.md` | `6a6cecf` |
| nanobot | `nanobot.md` | `29025f5` |
| UFO³ | `ufo3.md` | `cd9bfdd` |
| Open Interpreter + Workstation | `open-interpreter-workstation.md` | `5b07159c` / `e7318fdf` |
| Goose | `goose.md` | `caf59517` |
| OpenHands | `openhands.md` | 2026-08-27 fleet SHAs |
| Eigent | `eigent.md` | `6f42871` (+ late frontend verification) |
| Pi | `pi.md` | `4e49492` |
| OpenCode | `opencode.md` | `15537a41` |
| Claude Code | `claude-code.md` | npm v2.1.250 (doc-depth tiers) |
| Codex | `codex.md` | `6be2a6ca` |
| Cline | `cline.md` | `aa4753f4` |
| Cordis paper (verification) | baseline §2 | arXiv:2608.25512v1 |

*Compiled without designing or proposing DSH implementations, per the map's out-of-scope rules; every opportunity record states capability, sources, classification, boundary, and rationale only.*
