# Cordis Plugin Development — Runtime

Use this reference for approval, asynchronous activation, diagnostics, version semantics, update/retry/rollback, existing `@pluginId` modification, stop, and permanent removal.

## Identity and version model

Keep these identities distinct:

- **Plugin** — stable instance identified by `pluginId`.
- **Package** — immutable code version identified by `packageId`.
- **Run** — one activation attempt identified by `pluginRunId`.
- **`currentPackageId`** — latest successfully activated Package; it does not prove the Plugin is running now.
- **`nextPackageId`** — target awaiting approval/activation or the most recently failed update target.

Never overwrite a Package. A repair creates another Package under the same Plugin.

## Choose activation mode

| Current state | Target | Mode |
| --- | --- | --- |
| No current Package | any Package under the Plugin | `run` |
| Has current Package | same Package | `run` |
| Has current Package | different Package | `update` |
| Failed update | failed `nextPackageId` retry | `update` |
| Failed update | known-good `currentPackageId` rollback | `run` |

Use the exact `pluginId` and `packageId` returned or inspected. Do not infer version switching from names or timestamps.

## Approval and asynchronous Client activation

An unauthorized Client Package may return `awaiting-approval`. That is a handoff to the user, not a technical failure and not success.

An authorized Package may return `starting` while browser activation continues asynchronously. End the current tool flow and wait for the runtime/browser state update rather than polling in the same turn or claiming completion.

A user rejection is final for that approval attempt. Do not automatically retry after rejection.

## Diagnose and repair technical failure

After a technical failure:

1. Call `cordis_inspect_self(pluginId, packageId)` for the exact failed Package source and diagnostics.
2. If the diagnostic suggests a changed or unknown capability, refresh `cordis_inspect_list` and the exact affected live contract.
3. Preserve unaffected Host/Client code and define a new Package under the same Plugin.
4. Activate the new Package with `update` when replacing an existing current version; otherwise use the mode required by the table above.
5. If recovery requires the previous known-good version, explicitly `run` `currentPackageId`.

A failed update does not guarantee that the previous physical run has been restored. Rollback is an explicit activation.

## Modify an existing `@pluginId`

When the user identifies `@pluginId`, preserve that Plugin identity.

1. Read its base Package with `cordis_inspect_self(pluginId, packageId)`.
2. Preserve the Host or Client half that does not need change.
3. Call `cordis_define` with the existing Plugin identity rather than creating a replacement Plugin.
4. Use the newly returned `packageId`.
5. If a current Package already exists and the target differs, activate with `update` in the normal case.

If the referenced Plugin no longer exists, belongs to another Session, or disappeared on process restart, report that state. Do not create a same-named substitute and pretend it is the referenced Plugin.

## Stop versus undefine

Use `cordis_stop` for a reversible pause. It preserves Packages, grants, and version pointers so the Plugin can be inspected or restarted later.

Use `cordis_undefine` only for permanent removal when rollback, inspection, or restart is no longer needed. Treat it as destructive.

## Common diagnostic pivots

| Symptom | Inspect first |
| --- | --- |
| Service undeclared / property access rejected | whether code uses `ctx.x` without a matching hard dependency; otherwise use `ctx.get('x')` |
| timer access rejected | timer Service live contract and `inject: ['timer']` |
| Client parse failure | JSX, TypeScript syntax, imports, or unconfirmed globals |
| Slot registration failure | current subtree, exact Slot protocol, options, key/selector, occupants |
| UI page/render error | exact Client-render diagnostic and stack for that Run |
| `host.call` failure | handler name, active Run/Package, JSON args, Host-side dependencies |
| update failure | `currentPackageId` vs `nextPackageId`; repair next or explicitly run current |

## Runtime completion states

Claim successful completion only after the runtime reports successful activation and no relevant diagnostic remains.

For `awaiting-approval`, say the Package is awaiting approval. For `starting`, say activation has started and will finish asynchronously. For rollback, report which Package was explicitly reactivated. For stop/removal, report that lifecycle result rather than describing the Plugin as active.
