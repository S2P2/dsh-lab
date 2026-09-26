# Standard Lean preset

The shipped `standard` coding-agent preset edited by deletion — **plan mode, the workflow engine, and goals are removed**, and the prompt is trimmed to rules the tool schemas do not already carry — everything else is copied verbatim from `@deepseek-ai/dsh-web-app`'s `presets/standard.patch.yml` for the installed DSH version, plus the two preset-owned additions noted below.

## Format

This directory is a **DSH bundle** (`package.json` + `cordis.patch.yml`), the preset format of the current DSH: a bundle whose Loader patch inserts one `@deepseek-ai/dsh-agent-preset` declaration row (`preset-standard-lean`). The previous generation of this preset (`agent.cordis.yml` + `preset.yml`, built against `@deepseek-ai/dsh-agent-presets` 0.1.5-rc.2) used the legacy user-preset directory format that this DSH version no longer reads; it was replaced wholesale. It also kept goals and dropped the disabled Ralph row — this rebuild follows the current exclusion set instead.

## Included (identical to `standard`)

- full coding toolset: shell (bash/pwsh), file read/write/edit, glob/grep search
- background jobs, Skills catalog and loader, todos, `ask_user_question`, web search/fetch, `present`
- subagent and subagent-fork delegation with list/send/interrupt controls (codex/claude-code rows stay disabled, as in `standard`)
- isolated long-session compaction, `/compact`, and tool-result pruning
- workspace instructions (`AGENTS.md` chain) within a 64 KiB budget

## Prompt sections

Upstream is actively deduplicating guidance: rc.1→rc.2 shrank the glob, web_search, web_fetch, subagent, and write sections down to their unique rules and moved mechanics into tool descriptions. This preset finishes that job with a preset-local assemble listener (`plugins/lean-prompt-sections.mjs`) rather than a frozen `complete: true` persona, so upstream improvements to every other section keep arriving on upgrade:

- **Dropped**: `harness:source` (DSH checkout root), `app:web-surface` (Web GUI / HMR / no-replacement-server rules), `ui:deliverable-file-references` (deliverable-card and link-formatting policy — a two-line replacement lives in the persona suffix).
- **Rewritten**: `tool:edit` → only the read-first rule with its this-session exception; the match/`replace_all` semantics are already in edit's property descriptions.
- **Kept untouched**: everything upstream maintains as a unique rule (`tool:read`, `tool:write`, `tool:glob`, `tool:grep`, `tool:jobs`, `tool:bash`, `tool:web_*`, `tool:subagent`, the `@`-path semantics from `dsh-file-reference`).

**Watch list** — on every DSH upgrade, check these against the new sources and drop entries from the plugin when upstream deduplicates them:

| Section | Upstream status (0.1.7-rc.2) | Action when upstream fixes it |
|---|---|---|
| `tool:edit` | still duplicates property descriptions | remove the `REPLACE` entry; consider filing the dedup upstream (it matches their own rc.1→rc.2 pattern) |
| `harness:source`, `app:web-surface`, `ui:deliverable-file-references` | deployment-owned, not part of the dedup migration | keep dropping unless the deployment stops registering them |

`complete: true` deliberately suppresses all other prompt sections, not just decorative prose. Tool schemas and runtime-context snapshots remain, but first-party guidance for shell failures, filesystem-tool preference, untrusted web content, background work, goals, and file references is omitted. This makes the preset prompt-lean rather than behavior-identical to Standard and means new upstream prompt sections do not take effect automatically.

## Deliberately excluded

- **plan** — the `planning` group (`dsh-plan-mode`): no plan-mode section, no `exit_plan_mode`
- **workflow** — `workflow-ptc` (the `workflowEngine` provider) and `tool-workflow`: no `workflow` tool, and no `workflowEngine` isolate realm on the delegation group (no row left publishes it)
- **goals** — `command-goal` (the `/goal` command) and `tool-goal`: no `create_goal`/`get_goal`/`update_goal`. The goal service and round driver stay host-plane and simply go unused by agents on this preset
- Ralph stays `disabled: true` exactly as shipped — and cannot be flipped on here, because `tool-ralph` injects `workflowEngine`, whose provider this preset removes

## Install

Through the Web UI plugin manager, or:

```sh
dsh plugin --profile <profile> add /path/to/dsh-lab/presets/standard-lean
```

Then restart the Host and pick **Standard Lean** when starting a session.

## Upgrade drift

Rows resolve against whatever the deployment installs; upstream row schemas drift and mount validation fails loud. After upgrading DSH, re-diff and re-apply the deletions:

```sh
diff node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml presets/standard-lean/cordis.patch.yml
```

Expect exactly two preset-owned deltas beyond the deletions: the persona `suffix` lines and the `lean-prompt-sections` plugin row. Then walk the watch list above.

## Verifying a mount

Presets mount at Host start; edits to this directory do nothing until the Host restarts. After a restart, probe with a throwaway session and check what only a real Agent session proves:

1. **Tool catalog** — ask `list all tools`: expect the 21 tools of `standard` minus `exit_plan_mode`, `workflow`, `create_goal`, `get_goal`, `update_goal`, `plugin_manager` (and no others).
2. **Commands** — `/goal` is not offered; `/compact` still is.
3. **Prompt** — export the session log and inspect the `system/message`: no checkout-root paragraph, no GUI/HMR paragraph, no deliverable-formatting block; the edit paragraph is the single read-first sentence; the last line is the persona suffix (cwd + link-format lines).
4. **Delegation** — `subagent` still runs in the background and reports back.
5. **Cost baseline** — from the exported log's `request/header`: description chars and the input-token count of the first turn.

Reference numbers: the rc.1-era probe (2026-09-23, pre-stripper) measured a 6,554-char system prompt, 13,868 description chars, and 6,368 input tokens to answer "hi". On 0.1.7-rc.2 upstream dedup alone should already remove ~1.7k prompt chars before this preset's section surgery; record the new numbers here after the first probe.
