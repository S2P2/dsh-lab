# Upstream provenance

The Preset Studio surface of this package is adapted from DeepSeek App.

Upstream repository: `RongleCat/deepseek-app` (MIT, Copyright (c) 2026 RongleCat)

Pinned upstream commit: `e1be3e82119b85110b58f10c808076ecc7b422f4` (`main`, 2026-08-16, "fix: close #1 auto-approve chip and #2 live-turn freeze"). See the upstream `LICENSE` for the full license text; the MIT notice is also carried as a header comment in every adapted file below.

## Files adapted

| Upstream path | Local file | Adaptation |
|---|---|---|
| `src/renderer/lib/presetYaml.ts` | `src/preset-yaml.js` | Nearly verbatim port (TypeScript types stripped to JSDoc). `parseDumpLayers` and the `dsh --dump-config` projection are dropped: this plugin never derives preset paths or provenance from config dumps. `parseYamlValue` additionally rejects unbalanced flow collections so the row editor's `badConfig` save-abort is a real behavior (upstream's parser never throws, making its guard defensive only). |
| `src/renderer/components/settings/PresetStudio.tsx` | `src/preset-editor-model.js` | The framework-free editor model extracted verbatim: `EditorRow` tree, `editorFromRows`, `rowsFromEditor`, `mutateEditor`, `removeEditorRow`, `moduleShortName`. |
| `src/renderer/components/settings/PresetStudio.tsx` | `src/client.js` | The panel surfaces (roster with trust badges + copy-first flow, composition viewer grouped by display kind, generic row editor with per-row YAML config, package-name datalist) re-authored in the package's build-step-free `h()` style. The copy dialog is an in-panel `CopyForm` following upstream's `CopyForm` (PresetStudio.tsx:257-315): source select, required new id, optional name, inline hint, values kept on failure — with `window.prompt` retired and the copy itself delegated to the Host's `target.copy` command. Only small display helpers (`mutateEditor`, `removeEditorRow`, `categorizeRow`, `moduleShortName`) plus an advisory pre-save row check (a minimal mirror of this package's own `preset-yaml.js` definite-error rules — a local addition, upstream validates only on save) are inlined because the hand-authored bundle cannot import modules; parsing and serialization stay Host-side. |
| `src/renderer/components/settings/PresetStudio.tsx` | `src/studio-presenter.js` | New projection implementing the same presenter contract as the stock semantic presenter; consumes `preset-yaml.js`/`preset-editor-model.js` Host-side. The raw-YAML view of the composition file is an addition (upstream has no raw view). |
| `tests/presetYaml.test.ts` | `test/preset-yaml.test.js` | Test expectations ported from vitest to `node:test`, run against this repository's real presets (`presets/custom-creator`, `presets/writing`). |

## Deliberately not ported

- `window.desktop.dsh.dumpConfig()` provenance and `deriveDshHome`/`derivePresetPath` path derivation — replaced by DSH's authoritative `agentPresets` resolution; paths are never derived from config dumps.
- `window.desktop.fs.write` save path — replaced by the Host-side safe-write boundary (shared draft → guarded `draft.putFile`/`draft.putRows` → Apply with Git checkpoint and rollback).
- `SessionPresetChip` (hot-swaps the running session's preset) — the Session Preset stays a read-only indicator; session and target presets remain separate.
- `settings.mutate` default-preset mutation and `agentPreset.select/remove/openDocument` — not exposed by this package.
- Electron permission chips (`app.permission`, `app.confirm`, localStorage gates) — authorization is Host-side; client confirms are UX only.

## Upstream sync

When updating from a newer `RongleCat/deepseek-app`, re-diff the two upstream source files against the local adaptations:

```sh
# fetch the current upstream files, then diff against the ports
git diff --no-index .spec-notes/.upstream-52/presetYaml.ts packages/dsh-preset-authoring/src/preset-yaml.js
git diff --no-index .spec-notes/.upstream-52/PresetStudio.tsx packages/dsh-preset-authoring/src/preset-editor-model.js
```

Update the pinned commit above whenever the adaptation intentionally absorbs upstream changes. Keep the local adaptations (JSDoc, dropped dump-config seam, `parseYamlValue` strictness, browser inlining) documented in this table so the re-diff stays reviewable.
