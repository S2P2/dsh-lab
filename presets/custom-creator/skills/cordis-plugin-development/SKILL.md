---
name: cordis-plugin-development
description: Develop or repair dynamic Cordis Plugins. Use for Host Services or Events, Client Slots or themes, Package-private Client-to-Host calls, dynamic model Tools, Plugin version changes, approval failures, runtime diagnostics, restart, or rollback. Inspect the live Cordis contract before defining or activating a Package.
---

# Develop dynamic Cordis Plugins

Treat the **live contract** as authoritative: names, signatures, props, modes, availability, and registration protocols come from the current Inspect Provider results, not from examples or model memory.

## Operating loop

1. **Discover.** Call `cordis_inspect_list` to read the Host and Client Providers, methods, and schemas registered now.
2. **Inspect.** Query only the exact Services, Events, Builtins, Slots, theme tokens, or Tools the requested feature will use.
3. **Locate.** For a new Plugin, choose its first Package shape. For an existing `@pluginId`, call `cordis_inspect_self(pluginId, packageId)` before editing so the base source and diagnostics are known.
4. **Define.** Write plain JavaScript in `code.host`, `code.client`, or both and call `cordis_define`. Preview the code for the user when the tool flow supports preview.
5. **Activate.** Call `cordis_run` with the exact `pluginId` and `packageId` returned by define. Use `run` for first activation, restart, or rollback; use `update` to switch an existing Plugin to a different Package.
6. **Observe.** Treat approval, `starting`, waiting, Client loading, render failure, and technical failure as distinct states. Do not call a pending state success.
7. **Repair.** On technical failure, inspect the failed Package and its diagnostics, refresh any changed live contract, define a new immutable Package, and activate that Package. Never overwrite a failed Package.

`cordis_stop` pauses current effects while preserving Packages, grants, and version pointers. `cordis_undefine` is destructive and belongs only to permanent removal.

When `cordis_run` returns `awaiting-approval` or `starting`, end the current tool flow. Approval and browser activation complete outside the current tool turn.

## Choose the platform

| Requirement | Platform | Inspect first |
| --- | --- | --- |
| Files, commands, processes, networking | Host | relevant Host Service |
| Agents, durable Session data, Host lifecycle | Host | relevant Service and Event |
| Register a model Tool | Host | `harness` Builtin and visible Tool schemas |
| Page theme, layout, current page state | Client | Theme and Client Service contracts |
| Conversation/session data already supplied to UI | Client | target Slot props |
| Settings, sidebars, input, overlays, Tool cards | Client | Slot subtree and exact Slot contract |
| Fetch on Host and display on Client | Both | Host Service + package RPC + Client Slot |

Prefer the platform closest to the data owner. Reuse Slot props rather than adding Host RPC for data already present on Client. Prefer local component styling over global theme changes. Prefer additive inner Slots over replacing product-level UI regions.

## Branch references

Load only the reference for the branch being implemented:

- **Host branch** — Services, Events, dependency injection, timers, lifecycle effects, dynamic model Tools, or package-private Host handlers: read [`HOST.md`](HOST.md).
- **Client UI branch** — Slots, settings, session/page props, Tool cards, overlays, themes/styles, or the Client side of package RPC: read [`CLIENT.md`](CLIENT.md).
- **Runtime branch** — approval, `starting`, diagnostics, version semantics, update/retry/rollback, `@pluginId` modification, stop, or removal: read [`RUNTIME.md`](RUNTIME.md).

For a feature spanning Host and Client, read both Host and Client references. Load Runtime when activation or recovery behavior matters beyond the normal happy path.

## Shared execution rules

Both `code.host` and `code.client` are plain JavaScript function bodies that return a Cordis Plugin. Use the live Builtin contract for evaluator-provided globals.

Use JavaScript compatible with the evaluator: no TypeScript syntax, JSX, `import`, or `require`. Client React uses `React.createElement(...)`.

Prefer optional capability access through `ctx.get(name)` with an absence check. Declare `inject` only for a true hard dependency that should put the Plugin into waiting until Cordis can reactivate it.

Own every side effect through Cordis lifecycle APIs or a disposer returned by the live contract. Plugin stop, update, and removal must leave no contribution behind.

Treat Service instances, Event payloads, Slot props, Session and Conversation Snapshots, Tool state, and other DSH/Cordis objects as live internal data. Read only the leaf fields the feature needs and construct owned JSON from those scalar values. Do not recursively copy or serialize whole live objects.

## Inspect navigation

Provider names, methods, and inputs come from `cordis_inspect_list`. Common provider methods include:

- `Service.listService` — list callable Services, then query one Service for its exact methods, access rules, returns, and referenced types.
- `Event.listEvents` — list Events, then query one Event for its exact listener signature, mode, and referenced types.
- `Builtin.listBuiltins` — read evaluator-provided symbols and signatures that are not available through `ctx.get()`.
- `Slots.listSubTree` — list compact live UI topology, then query one exact Slot for protocol, props, occupants, replacement risk, and descendants.
- `Theme.listTokens` — read currently supported theme tokens.
- `Tool.listTools` — read Tool schemas currently visible to the Agent.

The Service/Event Catalog describes permitted interfaces; it does not prove a Service is mounted now. Runtime code calls real Services and Events rather than caching Catalog query results as business data.

## Completion

The current tool flow is complete only when one of these is true:

- the requested Package is active and no relevant runtime diagnostic remains;
- activation is explicitly `awaiting-approval`, and the user now owns the next action;
- activation returned `starting`, and the browser/runtime now owns the asynchronous completion;
- recovery intentionally reactivated the selected previous Package; or
- the user requested stop or permanent removal and that lifecycle action completed.

Before claiming completion, verify that every capability used came from the current live contract and every registered side effect has a Cordis-owned cleanup path.
