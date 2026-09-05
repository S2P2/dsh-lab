# Authoring Cordis presets

Load this reference when locating, copying, editing, or mount-validating an agent preset.

## Use the Host roster as the source of truth

`ctx.agentPresets` owns preset discovery, copying, resolution, and mount validation. First call `cordis_inspect_list`, then use the returned Host `Service.listService` provider and `cordis_inspect_query` to read the current `agentPresets` methods and signatures.

Use that live contract rather than hard-coded install paths or a cached list of shipped presets. The current Host operations this workflow relies on are:

- `list()` — discover Host rows, including `id`, `trust`, and the resolved composition path.
- `read(id)` — read one preset's composition text.
- `copy(from, id, name?)` — copy a whole preset into the writable root; it resolves to `void`.
- `resolve(id)` — resolve the actual Host path after `copy()` or before a direct file operation.
- `standingKeyFor(id)` — mount-validate one preset using the same composition semantics a session start uses.

The browser-facing roster is intentionally path-free: it reports preset metadata, `isDefault`, health, and whether the deployment is authorable, while the Host retains filesystem locations. Join browser state to a Host capability when a path is required; never reconstruct one in Client code.

Trust records where discovery found a preset, not whether an arbitrary path may be written. Treat `trust: system` as read-only, then have the Host establish that the resolved target directory is contained by its configured writable preset root before every edit/delete path. A `trust: user` row outside that root remains non-editable.

## Probe the roster when needed

Inspect APIs with `cordis_inspect_list` and `cordis_inspect_query`; neither tool invokes a business Service. When `agentPresets` is not otherwise callable, use the dynamic Plugin lifecycle:

1. call `cordis_define` with one Host-only Package that injects only `agentPresets` and `tools` and registers one narrowly named probe Tool;
2. activate the returned exact `pluginId` and `packageId` with `cordis_run mode:"run"`;
3. call the probe on the next step and preserve any exact diagnostic;
4. call `cordis_stop` to remove its Tool registration, then `cordis_undefine` to discard the definition.

A define records source but runs nothing. A run acknowledgement is lifecycle state, not the probe result. Keep each probe temporary and task-specific rather than creating a permanent `preset.*` Tool family.

## Copy-first authoring

Prefer `copy(from, id, name)` over constructing a preset directory from scratch. A copy starts from a composition that already mounts and preserves preset-owned skills and assets.

Use this sequence:

1. Discover the source preset and confirm its current `trust` and identity through the Host roster.
2. Copy it to a new id. Use an id accepted by the live API; current DSH expects lowercase alphanumerics and hyphens beginning with an alphanumeric character.
3. After `copy()` resolves with no value, call `resolve(newId)` and use that Host result as the created preset's actual path.
4. Confirm the resolved target is contained by the writable preset root.
5. Edit that resolved copy, including `preset.yml` display metadata and the necessary `agent.cordis.yml` rows, or open the shared Host draft when that service owns the authoring flow.
6. Apply the plane and realm rules from `SKILL.md`; when a changed row provides or may provide a Service, read [`REALMS.md`](REALMS.md).
7. Run `standingKeyFor(id)` once the finished candidate has been materialized coherently.
8. After a clean mount validation, hand off to a fresh session using the new preset to verify its exposed tools and prompt surface.

## File writes outside the workspace

The Host's writable preset root and the current session workspace are independent boundaries. Under a workspace-write sandbox, an edit outside the workspace can require explicit write escalation even when the Host has confirmed the path is an editable preset.

Escalate only the exact intended write and batch coherent file changes so the user is not asked to approve many tiny mutations. Host-side roster operations such as `copy()` do not need file-tool escalation.

## Mount validation

`standingKeyFor(id)` is the authoritative composition check. It catches failures such as:

- a package that cannot resolve;
- invalid plugin configuration;
- rows waiting on Services that never become available;
- preset-owned Services published into the process-global realm;
- collisions with Services the Host already supplies.

Use the exact returned diagnostic to repair the composition. If the failure names a Service, read [`REALMS.md`](REALMS.md) before changing isolation or plane ownership.

A roster shape flag such as `broken` is not equivalent to mount validation. Shape validation can confirm that a file parses while still missing activation, dependency, or realm failures.

Cordis Inspect describes the live runtime being queried. It does not prove that a newly authored preset will mount. Use `standingKeyFor(id)` for the authored preset itself.

A successful standing mount validates composition mechanics, not the final user-visible agent. The final behavioral check is a real session on the authored preset.