# Service realms in agent presets

Load this reference when a preset row provides, may provide, or consumes a Cordis Service whose ownership is not already clear.

## Realm invariant

A Service owned by an agent preset must live in a realm private to that mounting session, with every preset-side consumer that should resolve that Service inside the same realm.

A row that publishes a Service while loose in a preset publishes into the process-global realm. A second session can then collide with the first, so mount validation rejects the composition.

Do not infer provider ownership from a package or row name. Use the live runtime and mount diagnostics:

- inspect current Services and their owning fibers;
- compare the provider with the row being changed;
- for a row not present in the current composition, mount-validate the candidate preset and use the named Service in the rejection as evidence.

## Private preset-owned Services

Group the provider and all preset-side consumers that should resolve it under one `cordis:group` with an isolate realm:

```yaml
- id: delegation
  name: cordis:group
  group: true
  isolate:
    workflows: true
  config:
    - id: workflow-worker-thread
      name: '@deepseek-ai/dsh-workflow-worker-thread'
      config:
        provider: spawn
    - id: tool-workflow
      name: '@deepseek-ai/dsh-tool-workflow'
```

`true` means a realm private to each mounting session. Use this shape for a Service genuinely owned by the preset.

A string isolate label joins subtrees to the same realm symbol; it does not pool multiple provider instances. If two providers register the same Service in that shared realm, the second registration still fails. A named shared realm is therefore not a substitute for per-session isolation.

## Consumers of Host Services

A row that only consumes a Host-owned Service belongs outside a preset-private realm so it can resolve the Host instance.

This distinction is the practical test:

- **preset owns the Service** → provider and intended preset consumers share a private isolate realm;
- **Host owns the Service** → preset consumer stays in the Host-visible realm;
- **consumer exists outside the agent plane** → the provider itself belongs on the Host plane, not in the preset.

Wrapping a Host consumer in a private realm makes the Host Service invisible to it. Leaving a preset consumer outside its preset-owned provider's realm makes it resolve the wrong realm and usually leaves the row waiting or inert.

## Plane boundaries that must stay Host-side

Keep process registries and cross-session infrastructure on the Host plane. This includes the agent factory/loop, session persistence and query infrastructure, sandbox and approval boundaries, model routing, credentials/settings/telemetry, and registries whose consumers live outside one agent session.

The subagent registry is the canonical example: Host-side consumers query it across sessions, so a per-session registry would both starve those Host consumers and collide when another session registers the same provider Service. Presets contribute delegation tools; provider registries and provider backends remain Host-side.

For optional Codex or Claude Code providers, read [`SUBAGENTS.md`](SUBAGENTS.md).

## Diagnosing realm failures

Mount validation commonly exposes realm mistakes in two forms:

- the audit reports a process-global Service published by a preset row — move that preset-owned provider and its consumers behind a private isolate realm, or move the capability to the Host plane if it is actually shared;
- registration reports that a Service is already registered — determine which plane owns the existing Service before changing anything. A preset must consume a Host-owned Service rather than publish another root-realm instance.

Treat the named Service and current live ownership as the source of truth. Repair the ownership boundary first; avoid adding isolation merely to silence an error.