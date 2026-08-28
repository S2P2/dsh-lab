# OpenClaw orchestration-adjacent delta: fleet, specialist lanes, Workboard, Mantis, Swabble

**Researched:** 2026-08-28  
**OpenClaw source pin:** `533319b6753f4367581a59dc26b9c6d2fd19d66d`  
**Parent profile:** `docs/research/harness-map/openclaw.md`  
**Question:** verify the previously title-only `fleet`, `parallel-specialist-lanes`, `workboard`, `mantis`, and `swabble` surfaces and determine whether they change the D8 multi-agent/subagent comparison against DSH.

## Executive result

The five names are **not one multi-agent cluster**.

- `parallel-specialist-lanes` is an orchestration **operating pattern** layered on existing OpenClaw routing, queues, and subagents.
- Workboard is a **real durable local orchestration surface**: agent-sized cards, dependencies, claims/heartbeats, deterministic worker sessions, decomposition, dispatch, worker logs/protocol checks, replay-safe notifications, and a broad generated agent-tool surface.
- `fleet` is **multi-tenant instance management**, not agent collaboration: isolated per-tenant OpenClaw cells with their own Gateway, state, credentials, channels, container, and loopback port.
- `mantis` is **visual QA/evidence infrastructure**, not production orchestration.
- `swabble` is a **macOS local wake-word/transcription hook daemon**, not multi-agent machinery.

The earlier D8 conclusion therefore needs a targeted correction: OpenClaw now has a stronger open-source datapoint than the original profile captured. Its Workboard plugin productizes durable multi-agent work coordination on top of the Gateway subagent runtime. This does **not** make OpenClaw structurally equivalent to DSH's persistent-team/workflow-script model, but it upgrades the comparison from a generic "teams packaging" observation to a concrete plugin-shaped orchestration design.

## 1. Parallel specialist lanes

Primary source: `docs/concepts/parallel-specialist-lanes.md` @ the pinned SHA.

The document describes one Gateway routing different chats/rooms to dedicated agents while treating parallelism as a scarce-resource problem. OpenClaw already serializes mutations per session and caps global concurrency through its command queue; specialist lanes add policy: lane ownership, chat-vs-background-work decisions, handoff contracts, and smaller tool surfaces.

The recommended rollout is explicitly incremental:

1. written lane contracts + heavy work pushed to background subagents/tasks;
2. queue/model concurrency tuning;
3. an optional coordinator/traffic-controller that tracks active lane owners, duplicate requests, handoffs, blockers, and completed results.

This is mostly **policy and product guidance**, not a separate execution substrate.

**DSH classification: Packaging gap.** DSH already has the underlying D8 primitives (multi-agent/subagents, persistent teams, workflow scripts, isolation/depth model). The missing part is an opinionated "specialist lane" product pattern with standard ownership contracts, handoff conventions, and coordinator packaging.

## 2. Workboard

Primary sources: `docs/plugins/workboard.md`, `docs/plugins/reference/workboard.md`, and `extensions/workboard/src/tools.ts` @ the pinned SHA.

Workboard is bundled as `@openclaw/workboard`, disabled by default, and described as a local Kanban-style board for agent-owned cards and sessions. It is intentionally Gateway-local rather than a replacement for GitHub Issues/Linear/Jira.

### Durable orchestration model

Cards support lifecycle states (`triage`, `backlog`, `todo`, `scheduled`, `ready`, `running`, `review`, `blocked`, `done`), priorities, labels, optional assigned agent, linked task/run/session/source refs, and execution metadata.

The plugin persists richer operational state: attempts, comments, dependency links, proof, artifacts, attachments, worker logs, worker protocol state, claims, diagnostics, notifications, template/archive metadata, and recent lifecycle events.

Key orchestration mechanics:

- parent/child dependency links keep children from becoming ready until parents are done;
- agents claim cards and receive a secret claim token;
- long-running workers heartbeat claims;
- deterministic per-card subagent session keys keep repeated dispatches in the same worker lane;
- dispatch promotes dependency-ready work, handles stale claims/timeouts, claims a bounded batch, and starts workers through the Gateway subagent runtime;
- default dispatch starts at most three workers, ordered by priority/position/creation time, and starts at most one card per owner/agent;
- `workboard_specify` clarifies rough cards; `workboard_decompose` fans parent orchestration cards into linked children;
- worker-protocol violations can block a card when a worker exits without calling the structured completion/block tools;
- replay-safe notification subscriptions use durable cursors;
- workspace authority is persisted and re-intersected at dispatch so a card cannot widen a later caller's filesystem authority.

Workboard dispatch is not a generic process launcher. Execution remains in normal OpenClaw subagent sessions.

### Generated agent-tool catalog

The current documented Workboard agent surface is:

- `workboard_list`
- `workboard_read`
- `workboard_create`
- `workboard_link`
- `workboard_claim`
- `workboard_heartbeat`
- `workboard_release`
- `workboard_complete`
- `workboard_block`
- `workboard_attachment_add`
- `workboard_attachment_read`
- `workboard_attachment_delete`
- `workboard_worker_log`
- `workboard_protocol_violation`
- `workboard_board_create`
- `workboard_board_archive`
- `workboard_board_delete`
- `workboard_runs`
- `workboard_specify`
- `workboard_decompose`
- `workboard_notify_subscribe`
- `workboard_notify_list`
- `workboard_notify_events`
- `workboard_notify_advance`
- `workboard_notify_unsubscribe`
- `workboard_boards`
- `workboard_stats`
- `workboard_promote`
- `workboard_reassign`
- `workboard_reclaim`
- `workboard_comment`
- `workboard_proof`
- `workboard_unblock`
- `workboard_move`
- `workboard_dispatch`

The plugin reference also exposes dashboard bindings `workboard.cards.list`, `workboard.stats`, `workboard.boards.list` and dashboard action `workboard.dispatch`.

### DSH comparison

**DSH classification: Plugin opportunity (with some Packaging-gap overlap).**

The Workboard design is itself implemented as an OpenClaw plugin rather than a kernel primitive. DSH's plugin/seam architecture and existing D8 subagent/team mechanisms are sufficient conceptual seams for a comparable durable orchestration plugin: board/card state, dependency graph, claims/heartbeats, deterministic worker routing, decomposition tools, and recovery/notification surfaces.

The part that is merely product packaging is the Kanban/dashboard presentation. The stronger reusable idea is the durable worker protocol and lease/dependency state around subagent execution.

This is not currently evidence for a DSH **Core gap** unless implementation proves DSH cannot provide durable cross-session claim state or dispatch lifecycle from a plugin. The existing capability-map wording should therefore treat Workboard first as a plugin opportunity, not assume a kernel change.

## 3. Fleet

Primary source: `docs/cli/fleet.md` @ the pinned SHA.

`openclaw fleet` manages complete isolated OpenClaw **cells**. Each tenant cell owns its own Gateway, state, credentials, channel accounts, container, and loopback-only host port. Fleet supports Docker/Podman, applies container resource/security profiles, manages lifecycle/upgrade/backup/restore/doctor/removal, and explicitly says one cell should represent each tenant trust boundary rather than sharing one Gateway as a hostile multi-tenant boundary.

This is hosting/isolation machinery, not an agent-team primitive.

**DSH classification: Packaging gap for multi-instance deployment; Not applicable to D8.** DSH instances can already be run as separate processes/containers; the distinctive value is operator packaging: registry, per-tenant filesystem layout, resource limits, health-gated upgrades, backup/restore, and hardened lifecycle commands. If dsh-lab later wants a local multi-tenant supervisor, Fleet is a useful design reference, but it should live under deployment/security rather than multi-agent orchestration.

## 4. Mantis

Primary source: `docs/concepts/mantis.md` @ the pinned SHA.

Mantis captures visual end-to-end QA evidence for live transport comparisons and focused browser proofs, with baseline-vs-candidate worktrees, live Discord/Slack/Telegram scenarios, Crabbox desktop leases/VNC, screenshots/video, CI artifacts, and PR comments.

It is engineering validation infrastructure. Its internal use of worktrees, lanes, remote desktops, and automation should not be mistaken for user-facing multi-agent capability.

**DSH classification: Not applicable** to the harness capability comparison except as a testing/verification practice.

## 5. Swabble

Primary source: `apps/swabble/README.md` @ the pinned SHA.

Swabble is a Swift 6.2 macOS 26 wake-word hook daemon using on-device Speech.framework models. It supports a configurable wake word, local transcription, mic selection, foreground serving, hook command execution, transcript persistence, and launchd-oriented service stubs. The hook passes wake-gated transcript text to an arbitrary command with environment variables.

It is local voice ingress / speech automation, not collaboration or subagent orchestration.

**DSH classification: Plugin opportunity for voice ingress; Not applicable to D8.** A DSH plugin or external helper could expose speech-to-command/message behavior without changing the core harness.

## Synthesis-grid correction

The D8 row should be strengthened to record OpenClaw Workboard as the best concrete open-source example in this profile of **durable local multi-agent work orchestration layered above subagents**:

- dependency-aware work cards;
- agent claims + TTL/heartbeats;
- deterministic worker-session routing;
- bounded dispatch and stale-run recovery;
- explicit specification/decomposition tools;
- structured completion/block protocol;
- durable replay-safe notifications;
- operator-visible Kanban state.

Recommended normalized call against DSH: **Plugin opportunity**, not merely "teams productization = Packaging gap". Preserve **Packaging gap** for the specialist-lane operating pattern and UI/product presentation.

## Primary-source index

All sources below are from `openclaw/openclaw` at `533319b6753f4367581a59dc26b9c6d2fd19d66d`:

- `docs/concepts/parallel-specialist-lanes.md`
- `docs/plugins/workboard.md`
- `docs/plugins/reference/workboard.md`
- `extensions/workboard/src/tools.ts`
- `docs/cli/fleet.md`
- `docs/concepts/mantis.md`
- `apps/swabble/README.md`

No secondary-source claims are required for the conclusions above.
