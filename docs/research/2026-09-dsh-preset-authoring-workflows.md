# DSH preset-authoring workflow prior art

Date: 2026-09-05

Context: research for [#51 — Research and evaluate better preset-authoring workflows for DSH Creator mode](https://github.com/S2P2/dsh-lab/issues/51).

## Executive recommendation

**Conclusion: combine, do not build a new Preset Studio from scratch.**

The best current shape is a composed workflow around three complementary projects:

1. **Use `WeiLinCool/dsh-preset-studio` as the visual authoring / inspection surface.** It is the closest match to the missing higher-level UI: real preset roster and plugin inventory, graph projection, schema-driven forms, YAML validation, row insertion/removal, and preset diffing.
2. **Use `Qidianyan/dsh-dev` as the CLI scaffolding and preflight-validation layer.** It already implements `preset-new`, `preset-check`, environment diagnostics, and a documented fresh-session smoke-test flow via `dshctl`.
3. **Use `goecho/dsh-generation` when the desired workflow is agent-driven iteration from Creator mode.** It deliberately handles the fork → edit → fresh worker session → summarize loop without trying to mutate a running session.

Treat **`Moeblack/dsh-preset-kit` as a later packaging/distribution primitive**, not part of the authoring loop.

Do **not** adopt `hellowsz/dsh-agent-builder` as the main preset-authoring layer: it is a broader conversational agent builder centered on output-validation gates, not a general DSH preset editor. Likewise, the current `wr5912/dsh-agent-studio` repository is a design draft for a feedback-driven Harness improvement system and explicitly says its target implementation is not yet delivered.

The key architectural constraint comes from DSH itself: preset authoring is intentionally **copy-only at the roster API**, then edits happen in the copied preset's files; a session's preset is fixed after the session has produced output. A good authoring workflow should therefore make file editing, validation, and fresh-session testing cheap rather than trying to hot-swap the current session's composition.

Recommended user flow:

```text
fork/copy known-good preset
  → edit visually in Preset Studio or directly in files
  → validate with dsh-dev / DSH roster health
  → launch a fresh test session (dsh-generation or dshctl)
  → inspect result + diff
  → iterate
  → package with dsh-preset-kit only when distribution is needed
```

## DSH architectural boundary

Primary source: [`@deepseek-ai/dsh-agent-presets` package reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-presets/README.md) and the implemented [per-session preset architecture note](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md).

Relevant behavior:

- A preset is a directory containing `agent.cordis.yml` plus optional metadata/skills/assets.
- The official authoring API creates presets by copying an existing preset into the writable user root; callers do not submit arbitrary composition text through the copy operation.
- After copy, editing occurs in the preset's own files.
- Broken presets remain visible in the roster with diagnostics rather than disappearing.
- A session may switch presets only while blank. After messages/tool calls exist, the composition is locked because changing the tool set would invalidate recorded history.
- New sessions can pick up newer preset generations while already-running sessions keep the generation they started with.

This makes the edit → validate → **new session** loop a design property of DSH, not merely a Creator-mode UI flaw.

## Candidate comparison

| Candidate | Best role | What it materially provides | Main gap / risk | Recommendation |
| --- | --- | --- | --- | --- |
| [`WeiLinCool/dsh-preset-studio`](https://github.com/WeiLinCool/dsh-preset-studio) | Visual authoring + inspection | Full-page web IDE, real roster/inventory, Harness Graph, schema-driven config forms, live YAML parse/validation, add/remove rows, A/B diff, copy-as-new-preset | DSH's copy-only authoring seam means composition edits are not written back through the Host; drafts are exported/downloaded or applied to files. Bundled schemas cover known modules best. | **Adopt as the UI layer** |
| [`Qidianyan/dsh-dev`](https://github.com/Qidianyan/dsh-dev) | Scaffolding + validation | `preset-new --from`, `preset-list`, `preset-check`, environment doctor, plugin/MCP scaffolds; documented `dshctl new -p ...` smoke loop | CLI/skill rather than native web UI; editing is still direct YAML/files. README verification is against DSH `0.1.0-rc.6`, so current-version compatibility should be rechecked locally. | **Adopt/adapt as validator and CLI layer** |
| [`goecho/dsh-generation`](https://github.com/goecho/dsh-generation) | Creator iteration loop | `generation_fork` copies a known-good preset; `generation_run` mounts it into a fresh worker session and returns a bounded summary; human approval gates fork/run | Does not author YAML, validate structure, diff revisions, or replace Creator. Requires Creator-like caller and intentionally delegates edits to fs/bash. | **Adopt as optional iteration primitive** |
| [`Moeblack/dsh-preset-kit`](https://github.com/Moeblack/dsh-preset-kit) | Packaging/distribution | Copy publishing into user preset root, ownership tracking, conflict rules, update-on-boot, clean uninstall | Not an authoring or test workflow. | **Use later for distribution** |
| [`hellowsz/dsh-agent-builder`](https://github.com/hellowsz/dsh-agent-builder) | Conversational agent product builder | Requirement conversation, generated spec/prompt/preset, deterministic + AI output gates, web wizard + CLI, real-DSH evaluation | Scope is much broader and opinionated around output validation; it is not the static preset review/diff/runtime-introspection tool originally assumed in #51. | **Study for UX ideas; do not adopt as core preset editor** |
| [`wr5912/dsh-agent-studio`](https://github.com/wr5912/dsh-agent-studio) | Future feedback-driven configuration improvement | Proposed web/CLI/API feedback → candidate → evaluator → governor loop | README says `0.3-draft`, formal review not started, `v0.1.0` not implemented, and there is no valid startup/API/acceptance entry point yet. | **Do not depend on yet** |
| [`zimodzh/dsh-plugin-dev-skills`](https://github.com/zimodzh/dsh-plugin-dev-skills) and plugin scaffolds such as [`skyzhao1223/dsh-plugin-scaffold`](https://github.com/skyzhao1223/dsh-plugin-scaffold) | Preset-local plugin development | DSH plugin conventions, runnable plugin skeletons, loader verification | Helps only once authoring requires a custom plugin; does not solve preset composition UX. | **Reference on demand** |

## Findings by candidate

### 1. `dsh-preset-studio`: closest existing answer to “Preset Studio”

Primary sources:

- [README](https://github.com/WeiLinCool/dsh-preset-studio/blob/main/README.md)
- [package.json](https://github.com/WeiLinCool/dsh-preset-studio/blob/main/package.json)
- [tests](https://github.com/WeiLinCool/dsh-preset-studio/tree/main/tests)

The project directly targets the same pain point as #51. It projects the actual `agent.cordis.yml` into a graph rather than maintaining a second model, reads the real preset roster and plugin inventory, and provides a full-page editing surface rather than forcing the user through the narrow stock settings view.

Important capabilities already implemented/documented:

- visual graph of composition rows and group ownership;
- schema-driven forms for known plugins;
- raw YAML editor with parse/validation feedback;
- row insertion/removal from a draft;
- preset A/B line diff plus capability-row diff;
- copy-as-new-preset through the Host-supported copy seam;
- tests covering graph construction, edits, insertion, diff, schemas, registry, and validation.

The limitation is architectural rather than accidental: its README notes that composition text is not written back through the Host. This matches the current DSH package contract: authoring is copy-only at the API, after which files are edited directly.

**Implication for `dsh-lab`:** before designing another visual preset editor, test whether this plugin plus a small apply/validation helper already satisfies the target workflow.

### 2. `dsh-dev`: strongest cheap scaffold/validation layer

Primary source: [README](https://github.com/Qidianyan/dsh-dev/blob/main/README.md).

Its CLI maps well to #51's non-visual requirements:

- `dshdev preset-new <id> --from standard` creates a preset from a known-good base;
- online mode pulls the real base composition from the running DSH instance, reducing version drift;
- `dshdev preset-check` checks structure, YAML, `!!js` syntax, and runtime roster/load state;
- `dshdev doctor` catches environment/tooling problems;
- the documented development loop uses `dshctl` to create a **fresh session** with the candidate preset and send a smoke prompt.

This is a good complement to Preset Studio because the two cover different interfaces over the same file-based seam.

### 3. `dsh-generation`: correct primitive for Creator-driven iterations

Primary source: [README](https://github.com/goecho/dsh-generation/blob/main/README.md).

The plugin is deliberately small. Its own description is effectively the right abstraction boundary: “make, not a compiler.” Creator remains the environment that can inspect/edit, while the plugin adds lineage and fresh-session execution.

Its loop is:

```text
Creator/meta session
  → generation_fork
  → fs/bash edits
  → generation_run on a fresh worker
  → result summary returns to meta session
```

That directly addresses the most cumbersome part of the stock loop without pretending DSH can safely recompose a session with existing history.

It should remain optional because a user working in Preset Studio + terminal may prefer `dshctl` for fresh-session tests.

### 4. `dsh-preset-kit`: clearly downstream of authoring

Primary source: [README](https://github.com/Moeblack/dsh-preset-kit/blob/master/README.md).

This library solves preset publication into `$DSH_HOME/.agent-presets`, ownership, conflict avoidance, refresh, and uninstall. Those are useful once a preset becomes a distributable artifact, but none reduces the design/edit/test friction of #51.

### 5. `dsh-agent-builder`: useful UX inspiration, wrong core abstraction

Primary source: [README](https://github.com/hellowsz/dsh-agent-builder/blob/main/README.md).

The live repository exists, but its actual focus differs from the original issue description. It takes a natural-language requirement and creates an agent package with validation gates, then evaluates outputs through real DSH. Its design is about repeatable **result quality** and business-rule validation as much as Harness composition.

Useful ideas to borrow:

- beginner-facing conversational flow;
- explicit spec confirmation before generation;
- automatic positive/negative examples;
- persistent task/assets so UI and CLI can resume the same build;
- “honest failure” when validation budget is exhausted.

Those ideas could improve a future unified preset workflow, but adopting the whole project would pull `dsh-lab` into a much larger product design.

### 6. `dsh-agent-studio`: not an implementation candidate today

Primary source: [README](https://github.com/wr5912/dsh-agent-studio/blob/main/README.md).

The current repository states that the tool/technical plan is `0.3-draft`, formal review has not started, `v0.1.0` is not implemented, and there is no startup/API/acceptance surface that can currently be treated as delivered. It is therefore future architectural prior art, not something #51 should depend on.

## Representative workflow matrix

This is a source-level evaluation. The current runtime did **not** have a local DSH host in which to install and execute all candidates, so the behavioral checks below distinguish repository-supported capability from an end-to-end local verification still to perform.

| Representative task from #51 | Preset Studio | dsh-dev | dsh-generation | Stock Creator / direct files still needed? |
| --- | --- | --- | --- | --- |
| Fork/copy existing preset | Yes, copy-as-new | Yes, `preset-new --from` | Yes, `generation_fork` | No |
| Small plugin/tool row change | Visual/schema form for known rows; YAML for others | Direct YAML | Delegates to fs/bash | Sometimes: unregistered modules still need YAML/file editing |
| Validate preset before launch | Live parse/schema validation | Strongest explicit `preset-check` | No | DSH roster/mount health remains final authority |
| Useful error on broken YAML | Yes | Yes | Only run-time failure summary | No for syntax; Creator useful for deeper runtime diagnosis |
| Launch fresh test session | No dedicated worker loop | Via `dshctl` flow | Yes, purpose-built | No |
| Diff revisions | Yes | No | Lineage in session log, not a diff | No if Preset Studio is used |
| Runtime composition inspection | Static composition graph/inventory; runtime trace is described as later phase | Roster/load state | Returns tools used + worker summary | Creator remains strongest runtime-inspection escape hatch |
| Scaffold preset-local plugins/skills | Not its primary job | Plugin scaffold + skill navigation | No | Use plugin-development skills/scaffolds as needed |
| Package/distribute | No | No | No | `dsh-preset-kit` / ordinary bundle packaging |

## Proposed `dsh-lab` direction

Do not start by creating a new monolithic authoring plugin. Instead, validate the composed flow and only fill the smallest missing seams.

### Phase A — adopt and test

Install/evaluate together:

- `dsh-preset-studio`
- `dsh-dev` + `dshctl`
- `dsh-generation`

Run the representative tasks from #51 against one copied `standard` preset and one intentionally broken variant.

Questions to answer in the live test:

1. Does Preset Studio materially reduce the need to understand Cordis row structure for ordinary changes?
2. Can `dsh-dev preset-check` validate a Preset Studio-exported draft without additional glue?
3. Is `dsh-generation` meaningfully faster than `dshctl` for the edit/test loop when already working inside Creator?
4. What exact manual file-copy/apply step remains between a Studio draft and the writable preset directory?
5. Which diagnostics are still available only through Creator's runtime inspection tools?

### Phase B — adapt only the missing seam

If the live test confirms the composition above, a `dsh-lab` implementation should be a **thin workflow adapter**, not another editor. Candidate scope:

- one command/tool to apply an exported draft to a copied preset directory safely;
- call the existing validator;
- launch a fresh test generation/session;
- return preset health, relevant tool inventory, and diff/result links;
- keep Creator available for low-level runtime inspection.

Avoid duplicating:

- Preset Studio's graph/editor;
- `dsh-dev`'s scaffold/validation logic;
- `dsh-generation`'s worker lifecycle;
- `dsh-preset-kit`'s ownership/publication rules.

## Decision

**Combine.**

The previous four-way decision for #51 resolves as:

- **Adopt:** `dsh-preset-studio` for visual authoring/diff; `dsh-dev` for scaffold/preflight.
- **Adapt/integrate:** `dsh-generation` when Creator-driven iteration is desired.
- **Use downstream:** `dsh-preset-kit` for distribution.
- **Do not build yet:** a replacement “Preset Studio.” An existing project now covers that surface well enough that the next step should be live integration testing, not greenfield implementation.

## Sources

Primary / first-party sources used for conclusions:

- DeepSeek Harness preset package: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-presets/README.md
- DeepSeek Harness per-session preset architecture: https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md
- Preset Studio: https://github.com/WeiLinCool/dsh-preset-studio
- dsh-dev: https://github.com/Qidianyan/dsh-dev
- dsh-generation: https://github.com/goecho/dsh-generation
- dsh-preset-kit: https://github.com/Moeblack/dsh-preset-kit
- dsh-agent-builder: https://github.com/hellowsz/dsh-agent-builder
- dsh-agent-studio: https://github.com/wr5912/dsh-agent-studio
- dsh-plugin-dev-skills: https://github.com/zimodzh/dsh-plugin-dev-skills
- dsh-plugin-scaffold: https://github.com/skyzhao1223/dsh-plugin-scaffold
