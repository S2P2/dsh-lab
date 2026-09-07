# @s2p2/dsh-preset-authoring

Host-owned shared preset drafts, semantic composition adapters, DSH-native Host adapters, a local-only Git adapter, and a Better Sidebar authoring panel for DSH preset authoring. The panel is an adaptation of DeepSeek App's Preset Studio (generic Cordis rows, package selection from the plugin inventory, per-row YAML configuration, raw YAML view; provenance in [UPSTREAM.md](UPSTREAM.md)). The browser half is a hand-authored lazy-CJS bundle and consumes Better Sidebar 0.18 only through the external `ctx.get('betterSidebar')` / `registerTab` service contract. `dsh-better-sidebar` is an optional peer: when it is absent the Host service still loads, the browser logs a clear missing-panel status, and registration is reconciled if the service becomes available later. The package delegates authoritative roster, copy, directory materialization, and mount validation operations to DSH's `agentPresets` Host service. Its default activation composes those Host adapters with semantic adapters, local Git recovery, one shared draft service, the guarded panel route, and the Better Sidebar client.

## Public API

The Host plugin provides `ctx.presetAuthoringDrafts` (service key `presetAuthoringDrafts`). The same service can be created directly with `createPresetDraftService(adapters)` and exposes:

- `dispatch(command)` — the only mutation entry point.
- `getSnapshot()` — immutable current state.
- `subscribe(listener)` — observe snapshots; returns an unsubscribe function.

`PRESET_DRAFT_COMMANDS` contains commands for session selection, target opening, whole-tree file edits, narrow semantic edits, source-staleness checks, analysis, mount validation, apply, and history loading. Session preset identity is independent from the selected target. `EDIT_SEMANTIC` supports `setField` for plain scalar fields exposed by verified metadata, including surgical insertion of absent fields with deterministic defaults and `setEnabled` for rows with absent or literal-boolean `disabled`; conditional `!!js` state is rejected without changing the draft.

Every snapshot always contains `inspection`, `semanticDiff`, `rawDiff`, `preflight`, `mount`, `apply`, and `history` lifecycle slots. Their adapters are optional and report `unavailable` until an integration supplies them. `readTarget(targetId)` is required to open a draft and returns:

```js
{
  id: "target-id",
  editable: true,
  revision: "optional-adapter-revision",
  files: [{ path: "agent.cordis.yml", content: "..." }]
}
```

The `files` array represents the complete preset directory, including preset-local skills and assets. `createPresetTree`, `fingerprintPresetTree`, `decodePresetFile`, `decodePresetText`, and `assertSafePresetPath` are exported for adapters. Canonical trees are sorted, binary-safe, JSON-safe, and fingerprinted as a framed SHA-256 whole-tree value. Paths must be relative, unambiguous POSIX-style paths contained by the target directory.

`createHostAdapters(agentPresets)` delegates roster discovery, resolution, copying, and final mount validation to DSH. A target is editable only when its resolved composition path is physically contained by the first `user` root; trust labels alone never grant writes, so system and later user roots remain read-only. `copyTarget()` calls DSH's native `copy()` and then resolves the new id. The exported complete-directory read/materialize/restore helpers support candidate validation, and the mount adapter temporarily materializes the candidate, calls `standingKeyFor(targetId)`, restores the source tree, and rethrows DSH's original error object unchanged.

Adapter functions receive `{ sessionPresetId, target, source, draft }`. `createSemanticAdapters(options)` supplies inspection, safe edit, cheap preflight, semantic-summary, and raw-diff adapters. Its optional `plugins` registry is the sole source of additional category, field, and default metadata; unregistered plugins remain explicitly uninspected.

```js
createPresetDraftService({
  readTarget,
  ...createSemanticAdapters({
    plugins: {
      "example-model": {
        category: "Model",
        fields: { "config.temperature": { type: "number", default: 1 } },
      },
    },
  }),
  mount,
  apply,
  history,
});
```

The semantic parser accepts DSH's `!!js` scalars as inert source strings and never evaluates them. Supported edits replace only the addressed scalar range, surgically insert a missing supported scalar override into an unambiguous block mapping, or add a literal `disabled: true` to an existing row, preserving the rest of the original text and comments. Absent deterministic defaults are inspected with `configured: false`, their effective value, and default provenance.

Mount and Apply re-read the saved target and reject with `STALE_PRESET_DRAFT` if any file in the saved complete tree changed since the draft opened. Apply repeats that CAS check while holding the editable-root Git lock, materializes the complete candidate, invokes `standingKeyFor(targetId)`, and commits only the selected target. Mount and Apply recovery first restore the Git pre-validation rollback point and verify it against the captured Source Fingerprint, then fall back to the captured source tree. Diagnostics distinguish `recovered-via-fallback` from fatal `unrecovered`; validation never commits the candidate and always keeps it in the shared draft. Success advances source and draft to the saved revision. History restore replaces the selected target's whole directory and reopens the shared draft. Git degradation is reported separately and never prevents roster or draft use.

## Local Git adapter

`createLocalGitAdapter({ root })` owns local history for one editable preset root. Its interface is:

- `ensureBaseline()` — initialize `.git` when absent and ensure `HEAD` exists for explicit whole-root callers.
- `ensureTargetBaseline(target)` — initialize history and record only an as-yet-untracked selected target, leaving unrelated state untouched; Apply uses this seam.
- `recordHead()` — return the committed pre-Apply rollback point.
- `commitTarget(target, message)` — stage and commit only one target-directory pathspec.
- `listHistory(target, { limit })` — return commits relevant to that target.
- `restoreTarget(target, revision, message)` — replace the complete target directory from a revision, remove target-local untracked files, and commit the restoration.
- `withRootLock(operation)` — hold the shared root lock across a multi-step Apply/validation transaction. The callback receives the same operations without nested locking.

The adapter uses `execFile` without a shell, never configures a remote, and never pushes. Root mutations are serialized across adapter instances for the same resolved root. Operational Git/filesystem failures return `{ status: "degraded", operation, diagnostic }`; unsafe target pathspecs reject as caller errors. This keeps Git history and recovery optional rather than coupling them to preset loading or drafting.

## Presentation boundary

The Host backend — shared draft service, DSH host adapters, Git recovery, semantic adapters — is usable with no presentation surface attached. `createHostPresetAuthoring(agentPresets, { panel: false })` composes only the backend and returns `{ service, controller: null, host, git }`; the complete draft lifecycle (open, edit, validate, apply, history, restore) runs through `service` alone.

Every presentation surface consumes that backend through one replaceable presenter seam instead of domain or flow internals:

- `PRESET_PANEL_COMMANDS` — the frozen panel command vocabulary the panel controller accepts.
- `createPresetPanelPresenter()` — the semantic presenter. `project({ state, targets, sessionPresetId, test })` returns the immutable, path-free semantic view-model; `resolveEdit(rowId)` maps one projected control id back to the narrow Host-supported edit descriptor `{ operation: "setField" | "setEnabled", rowId, path? }` or `null`. Control registrations are rebuilt on every projection, so ids from an older view-model stop resolving.
- `createPresetStudioPresenter()` — the generic Preset Studio presenter; the shipped default. Same two-method contract, generic projection: roster targets carry trust provenance (display only — the Host's physical editability check stays authoritative), and `composition` projects the target's `agent.cordis.yml` as `{ path, present, source?, draft?, rows, editor }` — the saved and draft composition text (the raw-YAML view), a flattened read-only row summary with display kinds and depth, and the `EditorRow[]` editor tree from `preset-editor-model.js`. `resolveEdit()` always returns `null`: the studio writes whole rows, not per-field controls.

Any object providing `project()` and `resolveEdit()` can replace either presenter: pass it as `presenter` to `createPresetAuthoringController`, `createHostPresetAuthoring`, or the plugin's `apply(ctx, config)`. That injection point is the entire panel-replacement contract — controller, route, and backend behavior stay unchanged when the panel is swapped. The shipped activation (`createHostPresetAuthoring` and `apply`) defaults to the studio presenter; constructing a controller directly without a presenter keeps the semantic default, so the semantic presenter remains available as library code and can be restored for the shipped tab with `apply(ctx, { presenter: createPresetPanelPresenter() })`. Only one panel renders at a time — two concurrent panels would fight over the single Host draft through CAS conflicts.

The studio's write path is generic: the browser edits a local `EditorRow[]` tree (ephemeral form state, never a second draft), and `draft.putRows` sends the whole tree, which the controller serializes with `rowsFromEditor` + `stringifyPresetYaml` and persists through the existing whole-file `draft.putFile` domain command plus `draft.refreshAnalysis`. Serialization aborts with `PRESET_ROW_NEEDS_PACKAGE` / `PRESET_BAD_ROW_CONFIG` before any draft mutation. Round-trip honesty: `stringifyPresetYaml` drops comments and normalizes key order (upstream-pinned fidelity limit); opening or inspecting a preset never rewrites it — the saved file changes only on Apply, and the raw-YAML view and raw diff surface the exact serialization before that.

## Browser transport contract

The Preset tab sends same-origin `POST /dsh-preset-authoring/api` requests with this envelope:

```js
{ sessionId, cwd, command }
```

The route returns `{ ok: true, value: panelSnapshot }` or `{ ok: false, error: { code?, message, recovery?, fallbackRecovery?, recoveryState? } }`. The exact Host route accepts only bounded same-origin POST requests; originless mutations are accepted solely from a loopback non-browser client, returns stable JSON diagnostics, and is disposed with its Cordis effect. The browser keeps no second Preset Draft and refreshes this authoritative panel snapshot while the tab is visible. The command vocabulary expected by the browser is:

| Command | Purpose |
|---|---|
| `panel.snapshot` | Read roster, Session Preset, Target Preset, shared draft projection, validation/diff/history/Test slots |
| `target.open` `{ targetId }` | Explicitly select a Target Preset without changing the Session Preset |
| `target.copy` `{ sourceId, targetId }` | Copy a read-only system preset through the Host's DSH-native copy seam |
| `draft.edit` `{ rowId, value }` | Apply one Host-described supported field edit to the shared draft (semantic presenter) |
| `draft.toggle` `{ rowId, enabled }` | Enable/disable one Host-described supported row in the shared draft (semantic presenter) |
| `draft.putRows` `{ rows }` | Serialize the generic editor tree (`EditorRow[]`) Host-side and persist the whole `agent.cordis.yml` into the shared draft through `draft.putFile` (studio presenter) |
| `draft.refreshAnalysis` | Refresh cheap preflight plus semantic/raw diff |
| `draft.validateMount` | Run authoritative mount validation |
| `draft.apply` | Explicitly apply the shared draft |
| `history.load` | Load local history |
| `history.restore` `{ historyRevision }` | Manually restore a retained revision |
| `test.start` `{ targetId }` | Invoke a configured fresh-session handoff; otherwise return an explicit `launched: false` handoff payload without changing the current session |
| `inventory.list` | Read the installed-package inventory (`{ entries: [{ entryId, moduleName, enabled, fiberPhase }] }`) from the Host adapter layer; the row editor's package datalist is the sorted `moduleName` set plus `cordis:group` |

Every target-scoped command also requires `{ targetId, expectedRevision, expectedSourceFingerprint, expectedDraftFingerprint }` copied from one panel snapshot; mismatches reject with `PRESET_DRAFT_CONFLICT` before an adapter or filesystem side effect. `panelSnapshot` keeps roster/domain state Host-owned; its shape is the presenter view-model projected by the presentation boundary above. The studio view-model replaces `inspection` with `composition` (documented in the Presentation boundary section) and adds trust provenance to roster targets; the semantic view-model is `{ revision, sourceFingerprint, draftFingerprint, sessionPresetId, targets, target, stale, inspection: { categories }, semanticDiff, rawDiff, preflight, mount, apply, history, test }`. Categories contain rows with display metadata and, only where deterministic support exists, a `control` (`toggle`, `text`, `number`, or `select`). Unknown rows omit `control` and carry an explicit `metadata: "uninspected"` (or equivalent Host wording). Lifecycle slots use the domain's `{ status, value, diagnostic }` shape.

## Preset Studio provenance and upstream sync

The adapted Preset Studio surfaces, the `preset-yaml.js` composition adapter (dependency-free, like upstream), and the `preset-editor-model.js` editor tree are ported from `RongleCat/deepseek-app` at pinned commit `e1be3e82119b85110b58f10c808076ecc7b422f4` (MIT). [UPSTREAM.md](UPSTREAM.md) records exactly what was copied, adapted, rewritten, and excluded, and documents the upstream-sync re-diff instruction: on upstream changes, re-diff `src/renderer/lib/presetYaml.ts` and `src/renderer/components/settings/PresetStudio.tsx` against the local ports and update the pin when absorbing changes. No `window.desktop.*` bridge, Electron assumption, or dump-config path derivation survives the adaptation.
