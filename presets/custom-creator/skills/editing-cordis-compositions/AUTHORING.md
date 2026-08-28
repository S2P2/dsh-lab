# Authoring Cordis presets

Load this reference when locating, copying, editing, or mount-validating an agent preset.

## Use the roster as the source of truth

`ctx.agentPresets` owns preset discovery, authoring, and mount validation. Inspect its live API before relying on method signatures:

```text
cordis_inspect what:"api" name:"agentPresets"
```

Use the current contract rather than hard-coded install paths or a cached list of shipped presets. The important operations are:

- `list()` — discover presets, including `id`, `trust`, and the resolved composition path.
- `read(id)` — read one preset's composition text.
- `copy(from, id, name?)` — create a user-owned copy in the writable preset root.
- `resolve(id)` — resolve the actual composition path for a preset when the current API exposes it.
- `standingKeyFor(id)` — mount-validate one preset using the same composition semantics a session start uses.

Treat entries reported as `trust: system` as read-only templates. Author only against a user-owned preset.

## Probe the roster when needed

`cordis_mount` returns the mount acknowledgement, not arbitrary service results. When the roster is not otherwise exposed as a callable tool, mount a temporary plugin that injects `agentPresets` and `tools`, registers only the small probe you need, then unmount it when finished.

Example mount-validation probe:

```js
return {
  name: 'preset-tools',
  inject: ['agentPresets', 'tools'],
  apply(ctx) {
    harness.registerTool(ctx, harness.defineTool({
      name: 'preset_check',
      description: 'Mount-validate one preset by id.',
      parameters: { id: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render(_args, value) {
          return [{ type: 'text', text: value }]
        },
      },
      async execute(args) {
        try {
          await ctx.agentPresets.standingKeyFor(args.id)
          return 'mounted OK'
        } catch (error) {
          return error.message
        }
      },
    }))
  },
}
```

Keep such mounts as probes, not shipped capabilities.

## Copy-first authoring

Prefer `copy(from, id, name)` over constructing a preset directory from scratch. A copy starts from a composition that already mounts and preserves preset-owned skills and assets.

Use this sequence:

1. Discover the source preset and confirm its current `trust` and identity through the roster.
2. Copy it to a new user-owned id. Use an id accepted by the live API; current DSH expects lowercase alphanumerics and hyphens beginning with an alphanumeric character.
3. Resolve the created preset's actual path from the roster or the copy result.
4. Edit that resolved copy, including `preset.yml` display metadata and the necessary `agent.cordis.yml` rows.
5. Apply the plane and realm rules from `SKILL.md`; when a changed row provides or may provide a Service, read [`REALMS.md`](REALMS.md).
6. Run `standingKeyFor(id)` once the edit is coherent.
7. After a clean mount validation, hand off to a real session using the new preset to verify its exposed tools and prompt surface.

## File writes outside the workspace

The writable preset root may sit outside the current session workspace. Under a workspace-write sandbox, the first edit there can require explicit write escalation even though reading the resolved path does not.

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

`cordis_inspect` describes the composition of the session currently running the inspection. It does not prove that a newly authored preset will mount. Use `standingKeyFor(id)` for the authored preset itself.

A successful standing mount validates composition mechanics, not the final user-visible agent. The final behavioral check is a real session on the authored preset.