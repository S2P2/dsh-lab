# Standard Lean preset

A copy of the shipped `standard` coding-agent preset with the orchestration and planning surface trimmed off and the system prompt collapsed to a compact, complete persona.

## Included capabilities

- full coding toolset: shell (bash/pwsh), file read/write/edit, glob/grep search
- background jobs, Skills catalog and loader, goals, todos
- web search and fetch
- subagent and subagent-fork delegation with list/send/interrupt controls
- isolated long-session compaction, `/compact`, and tool-result pruning
- workspace instructions (`AGENTS.md` chain) within a 64 KiB budget
- a `complete: true` persona — the two-line prompt below is the entire system prompt, suppressing every per-tool guidance section the standard preset accumulates:

  > You are a coding agent powered by {{model}}, working in {{cwd}}.
  > Inspect relevant context, make focused changes, verify outcomes, and report changed files.

## Deliberately excluded

- plan mode and `exit_plan_mode`
- the workflow engine and `workflow` tool
- the Ralph loop
- the `workflowEngine` isolate realm (no row left publishes a service, so the delegation group carries no realm)
- optional native product subagents (`codex`, `claude-code` rows stay disabled, as in `standard`)

The suppression is text-only: tool schemas for everything retained still reach the model, and runtime-context snapshots (sandbox/approval policy) are unaffected — `complete` replaces prompt *sections*, not contexts.

## Upgrade drift

This file is a snapshot of the shipped `standard` preset from `@deepseek-ai/dsh-agent-presets` **0.1.5-rc.2**, edited by deletion. It pins no package versions; rows resolve against whatever the deployment installs, and upstream row schemas drift. It has already broken once across an upgrade (`dsh-persona` renamed `text` to `prefix`), and mount-validation fails loud rather than degrading silently.

After upgrading DSH, re-diff against the shipped `standard` preset and re-apply the exclusions:

```sh
diff node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml presets/standard-lean/agent.cordis.yml
```

Then mount-validate (a failed mount names the offending row):

```
standingKeyFor('standard-lean')
```

## Dogfood verification

Start a new session with the **Standard Lean** preset, then verify what only a real Agent session can prove:

1. The system prompt is exactly the two-line persona above — no per-tool guidance paragraphs.
2. The tool catalog has no `exit_plan_mode`, `workflow`, or `ralph`.
3. Ordinary delegation still works: `subagent` runs in the background and reports back.
