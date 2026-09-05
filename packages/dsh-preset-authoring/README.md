# @s2p2/dsh-preset-authoring

Host-owned shared preset drafts, a local-only Git adapter, and a Better Sidebar authoring panel for DSH preset authoring. The browser half is a hand-authored lazy-CJS bundle and consumes Better Sidebar 0.18 only through the external `ctx.get('betterSidebar')` / `registerTab` service contract. `dsh-better-sidebar` is an optional peer: when it is absent the Host service still loads, the browser logs a clear missing-panel status, and registration is reconciled if the service becomes available later. Real DSH mount validation remains a later integration.

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

## Browser transport contract

The Preset tab sends same-origin `POST /dsh-preset-authoring/api` requests with this envelope:

```js
{ sessionId, cwd, command }
```

The route returns `{ ok: true, value: panelSnapshot }` or `{ ok: false, error: { code?, message } }`. The Host route is intentionally a later implementation slice; the browser keeps no second Preset Draft and refreshes this authoritative panel snapshot while the tab is visible. The command vocabulary expected by the browser is:

| Command | Purpose |
|---|---|
| `panel.snapshot` | Read roster, Session Preset, Target Preset, shared draft projection, validation/diff/history/Test slots |
| `target.open` `{ targetId }` | Explicitly select a Target Preset without changing the Session Preset |
| `target.copy` `{ sourceId, targetId }` | Copy a read-only system preset through the Host's DSH-native copy seam |
| `draft.edit` `{ rowId, value }` | Apply one Host-described supported field edit to the shared draft |
| `draft.toggle` `{ rowId, enabled }` | Enable/disable one Host-described supported row in the shared draft |
| `draft.refreshAnalysis` | Refresh cheap preflight plus semantic/raw diff |
| `draft.validateMount` | Run authoritative mount validation |
| `draft.apply` | Explicitly apply the shared draft |
| `history.load` | Load local history |
| `history.restore` `{ revision }` | Manually restore a retained revision |
| `test.start` `{ targetId }` | Hand the saved Target Preset to a separate fresh-session flow |

`panelSnapshot` keeps roster/domain state Host-owned. Its browser-facing projection is `{ sessionPresetId, targets, target, stale, inspection: { categories }, semanticDiff, rawDiff, preflight, mount, apply, history, test }`. Categories contain rows with display metadata and, only where deterministic support exists, a `control` (`toggle`, `text`, `number`, or `select`). Unknown rows omit `control` and carry an explicit `metadata: "uninspected"` (or equivalent Host wording). Lifecycle slots use the domain's `{ status, value, diagnostic }` shape.
