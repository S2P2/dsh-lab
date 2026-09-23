# Standard Lean preset

An installable DSH bundle that declares the agent preset `standard-lean`: the shipped `standard` coding-agent preset with the orchestration and planning surface trimmed off.

Since DSH `0.1.7-alpha.1`, presets are `@deepseek-ai/dsh-agent-preset` declaration rows carried by bundle patches — the legacy `agent.cordis.yml` + `preset.yml` directory format is no longer read. This directory is the bundle: install it as a whole.

## Included capabilities

- the shipped `standard` persona and full scaffolded system prompt, unchanged (prefix "You are a coding agent powered by the {{model}} model.", cwd suffix, per-tool usage guidance, runtime-context snapshots)
- full coding toolset: shell (bash/pwsh), file read/write/edit, glob/grep search
- background jobs, Skills catalog and loader, and todos
- web search and fetch, plus openable file deliverables in the Web UI
- subagent and subagent-fork delegation with list/send/interrupt controls
- isolated long-session compaction, `/compact`, and tool-result pruning
- workspace instructions (`AGENTS.md` chain) within a 64 KiB budget

## Deliberately excluded

Relative to the shipped `standard` declaration:

- Goals (`command-goal`, `tool-goal`)
- plan mode (the `planning` group and `exit_plan_mode`)
- the Workflow engine (`workflow-ptc`, `tool-workflow`)
- the Ralph loop (`tool-ralph`)
- the `workflowEngine` isolate realm — no row left publishes that service, so the delegation group carries no realm

Optional native product subagents (`codex`, `claude-code`) stay disabled, exactly as in `standard`.

## Install

Dogfooding from this checkout:

```sh
dsh plugin --profile web add ../dsh-lab/presets/standard-lean
```

Then restart `dsh web`, or install from an agent session with `plugin_manager` `install_bundle` targeting this directory's absolute path. **Standard Lean** appears on the agent roster after `order: 4` (cordis).

## Upgrade drift

This bundle pins no package versions; its rows resolve against whatever the deployment installs, and upstream row schemas can drift. It has broken before across upgrades (e.g. `dsh-persona` renaming `text` to `prefix`), so after upgrading DSH:

1. Locate the shipped source: `presets/standard.patch.yml` under `@deepseek-ai/dsh-web-app` in the active DSH installation (for an npx install: `<npx-cache>/<hash>/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml`).
2. Diff it against this bundle's declaration:

   ```sh
   diff -u "$SHIPPED_STANDARD_PATCH" presets/standard-lean/cordis.patch.yml
   ```

3. Confirm every difference is one of the intentional removals listed above (plus the `id`/`name`/`description`/`order` header fields). Incorporate unrelated upstream additions such as ordinary coding or delivery tools.
4. Reinstall the bundle and start a fresh Web session with **Standard Lean** to check activation diagnostics — file comparison alone cannot verify imports, service dependencies, or isolation.

## Dogfood verification

Start a new session with the **Standard Lean** preset (existing sessions keep the plugin revision they started with), then verify what only a real Agent session can prove:

1. The preset activates without diagnostics.
2. The system prompt carries the standard persona prefix/suffix and scaffolded guidance, with no goal/plan/workflow/ralph sections.
3. The tool catalog has no `create_goal`, `get_goal`, `update_goal`, `exit_plan_mode`, `workflow`, or `ralph`.
4. The catalog still includes file/search tools, web search/fetch, jobs, skills, todos, delegation controls, and `present`.
5. Create a small requested file and confirm `present` exposes it as an openable Web deliverable.
6. Run an ordinary background `subagent` and confirm that it reports back.
7. Confirm `/compact` remains available in a long session.
