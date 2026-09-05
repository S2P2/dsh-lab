# @s2p2/dsh-preset-authoring

Host-owned shared preset drafts for DSH preset authoring. The package supplies the draft domain plus a local-only Git adapter; it does not yet include Better Sidebar UI or real DSH mount validation.

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

## Local Git adapter

`createLocalGitAdapter({ root })` owns local history for one editable preset root. Its interface is:

- `ensureBaseline()` — initialize `.git` when absent and ensure `HEAD` exists.
- `recordHead()` — return the committed pre-Apply rollback point.
- `commitTarget(target, message)` — stage and commit only one target-directory pathspec.
- `listHistory(target, { limit })` — return commits relevant to that target.
- `restoreTarget(target, revision, message)` — replace the complete target directory from a revision, remove target-local untracked files, and commit the restoration.
- `withRootLock(operation)` — hold the shared root lock across a multi-step Apply/validation transaction. The callback receives the same operations without nested locking.

The adapter uses `execFile` without a shell, never configures a remote, and never pushes. Root mutations are serialized across adapter instances for the same resolved root. Operational Git/filesystem failures return `{ status: "degraded", operation, diagnostic }`; unsafe target pathspecs reject as caller errors. This keeps Git history and recovery optional rather than coupling them to preset loading or drafting.
