# @s2p2/dsh-preset-authoring

Host-owned shared preset drafts for DSH preset authoring. This first slice supplies the domain and adapter boundary only: it does not include Better Sidebar UI, Git implementation, or real DSH mount validation.

## Public API

The Host plugin provides `ctx.presetAuthoringDrafts` (service key `presetAuthoringDrafts`). The same service can be created directly with `createPresetDraftService(adapters)` and exposes:

- `dispatch(command)` — the only mutation entry point.
- `getSnapshot()` — immutable current state.
- `subscribe(listener)` — observe snapshots; returns an unsubscribe function.

`PRESET_DRAFT_COMMANDS` contains commands for session selection, target opening, whole-tree file edits, source-staleness checks, analysis, mount validation, apply, and history loading. Session preset identity is independent from the selected target.

Every snapshot always contains `semanticDiff`, `rawDiff`, `preflight`, `mount`, `apply`, and `history` lifecycle slots. Their adapters are optional and report `unavailable` until a later integration supplies them. `readTarget(targetId)` is required to open a draft and returns:

```js
{
  id: "target-id",
  editable: true,
  revision: "optional-adapter-revision",
  files: [{ path: "agent.cordis.yml", content: "..." }]
}
```

The `files` array represents the complete preset directory, including preset-local skills and assets. `createPresetTree`, `fingerprintPresetTree`, `decodePresetFile`, `decodePresetText`, and `assertSafePresetPath` are exported for adapters. Canonical trees are sorted, binary-safe, JSON-safe, and fingerprinted as a framed SHA-256 whole-tree value. Paths must be relative, unambiguous POSIX-style paths contained by the target directory.

Adapter functions receive `{ sessionPresetId, target, source, draft }`. These are seams, not implementations:

```js
createPresetDraftService({
  readTarget,
  semanticDiff,
  rawDiff,
  preflight,
  mount,
  apply,
  history,
});
```

Mount and apply re-read the saved target and reject with `STALE_PRESET_DRAFT` before calling their adapter if any file in the saved complete tree changed since the draft opened.
