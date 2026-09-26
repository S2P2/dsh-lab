# Standard Lean preset

The shipped `standard` coding-agent preset edited by deletion: **plan mode, the workflow engine, and goals are removed**; everything else is copied verbatim from `@deepseek-ai/dsh-web-app`'s `presets/standard.patch.yml` for the installed DSH version.

## Format

This directory is a **DSH bundle** (`package.json` + `cordis.patch.yml`), the preset format of the current DSH: a bundle whose Loader patch inserts one `@deepseek-ai/dsh-agent-preset` declaration row (`preset-standard-lean`). The previous generation of this preset (`agent.cordis.yml` + `preset.yml`, built against `@deepseek-ai/dsh-agent-presets` 0.1.5-rc.2) used the legacy user-preset directory format that this DSH version no longer reads; it was replaced wholesale. It also kept goals and dropped the disabled Ralph row — this rebuild follows the current exclusion set instead.

## Included (identical to `standard`)

- full coding toolset: shell (bash/pwsh), file read/write/edit, glob/grep search
- background jobs, Skills catalog and loader, todos, `ask_user_question`, web search/fetch, `present`
- subagent and subagent-fork delegation with list/send/interrupt controls (codex/claude-code rows stay disabled, as in `standard`)
- isolated long-session compaction, `/compact`, and tool-result pruning
- workspace instructions (`AGENTS.md` chain) within a 64 KiB budget
- the stock `standard` persona — the prompt is unchanged; only the tool surface is trimmed

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

## Dogfood verification

Start a new session with **Standard Lean**, then verify what only a real Agent session can prove:

1. The tool catalog has no `exit_plan_mode`, `workflow`, `create_goal`, `get_goal`, or `update_goal`.
2. `/goal` is not offered as a command.
3. Ordinary delegation still works: `subagent` runs in the background and reports back.
