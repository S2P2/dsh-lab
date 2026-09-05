---
name: editing-cordis-compositions
description: Author or validate DSH Cordis agent presets. Use when copying or editing a preset, operating on a shared preset draft, changing plugin rows, deciding Host vs Agent ownership or isolate realms, diagnosing mount failures, or exposing optional native subagent tools.
---

# Edit Cordis compositions

A Cordis composition decides which plugin rows contribute capabilities to a DSH runtime. For preset work, use three leading concepts: **ownership** decides which preset may be written, **plane** decides where a capability belongs, and **realm** decides where a preset-owned Service lives.

## Operating path

1. **Discover ownership.** Use the live Host roster to identify the target and resolve its location. Treat trust as provenance; editability requires the Host to confirm that the target directory is contained by the current writable preset root.
2. **Choose the plane.** Decide whether each changed capability belongs to the shared Host or to one Agent session before moving or adding rows.
3. **Start from a copy.** For a new preset, call `copy()` through the roster, then resolve the new id in a separate call; `copy()` returns no path.
4. **Choose saved or draft editing.** When a Host-owned preset draft service is present, operate on its shared draft rather than maintaining another candidate. Otherwise edit the roster-resolved files directly.
5. **Edit coherently.** Update `preset.yml` display metadata and `agent.cordis.yml` rows together. Preserve the source composition's required consumer/provider relationships.
6. **Resolve realms.** For every changed row that provides or may provide a Service, establish who owns that Service and put preset-owned providers and intended preset consumers in the same private realm.
7. **Mount-validate.** Run the roster's standing mount validation on the finished materialized composition and repair every reported package, config, activation, or Service-ownership failure.
8. **Verify behavior.** After mount validation succeeds, ask for or perform a fresh session using the authored preset to confirm the intended tools and prompt surface are actually present.

## Ownership

The live Host roster is authoritative for preset identity, trust, and resolved paths. Its browser projection is deliberately path-free. A preset reported as system-owned is a template to read or copy, but `trust: user` alone does not grant writes: the Host must also establish that the resolved target is contained by the configured writable root.

Keep the system/user boundary intact even when direct filesystem access appears possible. A deployment upgrade can replace system presets, and changing the Creator preset can remove the very authoring capability needed to recover.

For roster APIs, copying, resolved paths, write escalation, mount probes, and validation diagnostics, read [`AUTHORING.md`](AUTHORING.md). When the Preset panel's shared draft is involved, read [`DRAFTS.md`](DRAFTS.md).

## Plane

**Host plane** owns process-wide and cross-session infrastructure: registries, agent/session infrastructure, persistence, storage/settings/credentials/telemetry, sandbox and approval boundaries, model routing, and provider registries with consumers outside one Agent session.

**Agent plane** contributes what one session adds to those Host registries: its Tools, persona/prompt sections, compaction policy, and Services whose complete provider/consumer lifetime belongs to that session.

Use the consumer boundary as the deciding test: if a Service has a consumer outside one Agent session, its provider belongs on the Host plane. A preset can consume that Host Service but should not create a per-session replacement.

A preset directory contains `agent.cordis.yml` and may carry `preset.yml` display metadata plus preset-local skills/assets. Use the live roster to locate it; deployments can configure roots differently.

## Realm

A Service genuinely owned by a preset needs a private per-session realm, and every preset-side consumer intended to resolve it must share that realm. A row that only consumes a Host Service stays in the Host-visible realm.

This is not a naming convention: determine Service ownership from the live runtime and mount diagnostics. Isolation exists to express correct ownership, not merely to silence registration errors.

For provider/consumer grouping, isolate semantics, Host-only boundaries, and Service collision diagnosis, read [`REALMS.md`](REALMS.md).

## Branch references

Load branch material only when the task reaches it:

- **Authoring** — locating, copying, editing, probing, or mount-validating presets; sandbox writes; validation errors: read [`AUTHORING.md`](AUTHORING.md).
- **Shared drafts** — inspecting or changing the Preset panel's candidate, handling stale source revisions, or temporarily bridging its Host service: read [`DRAFTS.md`](DRAFTS.md).
- **Realms** — a row provides or may provide a Service, a consumer waits unexpectedly, or validation reports a Service collision/global publication: read [`REALMS.md`](REALMS.md).
- **Native subagents** — exposing Codex or Claude Code delegation, installing their provider bundles, or adding named provider instances: read [`SUBAGENTS.md`](SUBAGENTS.md).

## Completion

**Composition completion** requires all of the following:

- the Host confirms the edited target lies under the writable preset root;
- every changed capability has an explicit Host/Agent plane decision;
- every changed Service provider has resolved ownership and realm placement;
- metadata and composition edits reach either the roster-resolved target or its one Host-owned shared draft;
- when a draft was used, each mutation carried the exact current source revision and did not overwrite a stale source;
- standing mount validation returns successfully with no relevant inactive row or Service diagnostic.

**Behavioral verification** is complete only when a real session using that preset exposes the intended Tools and prompt surface. A clean standing mount proves the composition can mount; it does not by itself prove the resulting Agent has the intended behavior.