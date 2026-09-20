# Standard Lean preset

A copy of the shipped `standard` coding-agent preset with the orchestration and planning surface trimmed off and the system prompt collapsed to a compact, complete persona.

## Included capabilities

- full coding toolset: shell (bash/pwsh), file read/write/edit, glob/grep search
- background jobs, Skills catalog and loader, goals, todos
- web search and fetch, plus openable file deliverables in the Web UI
- subagent and subagent-fork delegation with list/send/interrupt controls
- isolated long-session compaction, `/compact`, and tool-result pruning
- workspace instructions (`AGENTS.md` chain) within a 64 KiB budget
- a `complete: true` persona — the two-line prompt below is the entire system prompt section:

  > You are a coding agent powered by {{model}}, working in {{cwd}}.<br>
  > Inspect relevant context, make focused changes, verify outcomes, and report changed files.

`complete: true` deliberately suppresses all other prompt sections, not just decorative prose. Tool schemas and runtime-context snapshots remain, but first-party guidance for shell failures, filesystem-tool preference, untrusted web content, background work, goals, and file references is omitted. This makes the preset prompt-lean rather than behavior-identical to Standard and means new upstream prompt sections do not take effect automatically.

## Deliberately excluded

- plan mode and `exit_plan_mode`
- the workflow engine and `workflow` tool
- the Ralph loop
- the `workflowEngine` isolate realm (no row left publishes a service, so the delegation group carries no realm)
- optional native product subagents (`codex`, `claude-code` rows stay disabled, as in `standard`)

The suppression is text-only: tool schemas for everything retained still reach the model, and runtime-context snapshots (sandbox/approval policy) are unaffected — `complete` replaces prompt *sections*, not contexts.

## Upgrade drift

This file was last synchronized with the shipped `standard` preset from `@deepseek-ai/dsh-agent-presets` **0.1.6-alpha.2**. It pins no package versions; rows resolve against whatever the deployment installs, and upstream row schemas can drift. It has already broken once across an upgrade (`dsh-persona` renamed `text` to `prefix`), and newer Standard rows must be reviewed rather than silently omitted.

After upgrading DSH:

1. Locate `@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml` under the active DSH deployment or Profile installation. Its location varies; do not assume this repository has the package in its own `node_modules`.
2. Diff that file against this preset:

   ```sh
   SHIPPED_STANDARD=/absolute/path/to/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml
   diff -u "$SHIPPED_STANDARD" presets/standard-lean/agent.cordis.yml
   ```

3. Confirm that every difference is intentional: the complete persona, removal of Plan, Workflow, disabled Ralph and `workflowEngine`, and retained disabled native-subagent templates. Incorporate unrelated upstream additions such as ordinary coding or delivery tools.
4. Start a fresh Web session with **Standard Lean** and check its activation diagnostics. File comparison alone cannot verify imports, service dependencies, or isolation.

## Dogfood verification

Start a new session with the **Standard Lean** preset, then verify what only a real Agent session can prove:

1. The preset activates without diagnostics.
2. The system prompt is exactly the two-line persona above, while runtime sandbox/approval context and workspace instructions still appear.
3. The tool catalog has no `exit_plan_mode`, `workflow`, or `ralph`.
4. The catalog still includes file/search tools, web search/fetch, jobs, skills, goals, todos, delegation controls, and `present`.
5. Create a small requested file and confirm `present` exposes it as an openable Web deliverable.
6. Run an ordinary background `subagent` and confirm that it reports back.
7. Confirm `/compact` remains available in a long session.
