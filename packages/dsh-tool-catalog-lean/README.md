# @s2p2/dsh-tool-catalog-lean

Lean model-facing tool catalog for DSH. A `standard-lean` session presents 23
stock tools whose serialized catalog costs ~21k characters, ~70% of it
description prose; the five largest definitions alone consume ~42% before the
conversation starts. This plugin keeps every tool — same names, same
parameters, same runtime behavior — and shortens only what the model reads:
description strings.

## How it works

The plugin registers one `system-prompt/assemble` waterfall listener (the
public, authoritative seam `dsh-system-prompt` uses to build the prompt).
When the system prompt is assembled, it replaces `assembly.tools` with a
projection through a curated description map keyed by tool name:

- the tool-level `description`, and
- every `description` string found recursively inside `parameters`
  (and `output_schema` when present),

are swapped for curated, semantically faithful short forms. Everything else
passes through **by construction** — names, types, `required` arrays, enums,
`additionalProperties` flags, and all structure are never written. Tools
without a curated entry (future stock tools, MCP-registered `mcp__*` tools)
are delivered byte-identical to what the host assembled.

The transform is a pure, deterministic function over the tool-schema array
(`src/transform.js`); the listener only wires it into the waterfall. No
timestamps, environment reads, or per-session variation, so the tool-schema
prefix stays stable across turns within a session (one benign prefix-cache
invalidation on first install).

## What is NOT touched

- Runtime tool registration, validation, sandboxing, approvals, or execution
  — a tool call behaves exactly as without this plugin.
- Tool visibility: nothing is hidden, no proxy/search tool, no
  `ctx.tools.restrict()`.
- Prompt shape: no prompt sections, no context sections, no variables of its
  own (so `complete: true` personas are unaffected).
- Anything that is not a `description` string inside a curated tool schema.

## Install

```sh
dsh plugin --profile web add @s2p2/dsh-tool-catalog-lean
# or, before publishing, from a checkout:
dsh plugin --profile web add ../dsh-lab/packages/dsh-tool-catalog-lean
```

Then restart `dsh web`. Uninstalling restores stock descriptions with no
behavioral residue.

Note: pnpm 11+ gates freshly published packages behind `minimumReleaseAge`
(24h default); set `minimumReleaseAge: 0` in the profile's
`pnpm-workspace.yaml` for your own fresh packages.

## Measured effect

Against the captured 23-tool stock catalog (`test/fixtures/stock-tools.json`),
compact-JSON serialization, description chars = tool-level plus every
parameter-level description string (the same counting as the session-log
analysis):

| metric | stock | curated | reduction |
| --- | ---: | ---: | ---: |
| catalog, compact JSON | 21,062 | 14,336 | −32% |
| description chars | 14,977 | 8,279 | −45% |

Per tool (description chars, stock → curated):

| tool | stock | curated | |
| --- | ---: | ---: | ---: |
| bash | 2,717 | 1,457 | −46% |
| subagent_fork | 1,217 | 529 | −57% |
| subagent | 1,189 | 539 | −55% |
| list_agents | 1,187 | 582 | −51% |
| todo_write | 961 | 463 | −52% |
| glob | 724 | 422 | −42% |
| update_goal | 672 | 455 | −32% |
| ask_user_question | 661 | 362 | −45% |
| read_image | 604 | 358 | −41% |
| edit | 594 | 343 | −42% |
| job_output | 591 | 359 | −39% |
| interrupt_agent | 551 | 294 | −47% |
| send_message | 542 | 266 | −51% |
| grep | 528 | 379 | −28% |
| create_goal | 485 | 264 | −46% |
| write | 413 | 247 | −40% |
| job_kill | 265 | 177 | −33% |
| get_goal | 236 | 188 | −20% |
| skill | 235 | 147 | −37% |
| web_search | 220 | 137 | −38% |
| read | 201 | 165 | −18% |
| web_fetch | 99 | 78 | −21% |
| job_list | 85 | 68 | −20% |

Cuts concentrate on the five largest definitions (bash, subagent_fork,
subagent, list_agents, todo_write: −46…−57%), per spec #77's priority; tools
whose stock text is already terse (read, web_fetch, job_list, get_goal) are
compressed lightly on purpose.

### Reviewing and improving wording

All curated prose lives in one versioned place: `descriptionMap` in
`src/map.js`. A wording improvement is a one-place edit there. Two neighbors
keep edits honest:

- `safetyChecklists` (same file) pins, per tool, the facts the curated
  descriptions must still state — `test/map.test.js` iterates the map and
  fails on any dropped fact, so wording edits cannot silently lose safety
  semantics.
- The same test file twin-walks stock vs projected schemas: every curated
  string must land on a stock description position (no silent no-ops from
  typos), everything else stays byte-identical, and the totals must stay
  within the compression guards (≥40% description-char and ≥25% catalog
  reduction, above a >20% description floor that catches over-trimming).

Property descriptions that merely restate what the schema already confesses
(parameter names, types, enum values, defaults, required-ness) are curated
to `""` on purpose — the schema one line away is the source of truth.

## Status

🌱 full curated map (#80 of spec #77): every stock tool from the captured
session has a curated entry with a behavior-preservation checklist — bash's
checklist pins fresh shell, exit-code marker, sandbox-denial marker, one-shot
escalation with justification, tail truncation, and background-via-job-id;
the delegation tools pin isolated- vs inherited-context, the background
default, the completion notice, and send_message steering; todo_write pins
full-list-replacement and the status meanings. Config (enable/disable,
preset overrides, diagnostics) follows in #81.

Tests (`npm test`, no dependencies) run against the captured 23-tool stock
catalog committed under `test/fixtures/`, including a safety invariant that
strips every description from original and projected catalogs and asserts
deep equality, pass-through and determinism checks, and an integration test
that mounts the listener through a real `@deepseek-ai/cordis` waterfall when
one is importable (see `test/helpers.js` for the lookup, override with
`DSH_TEST_CORDIS_ENTRY=/path/to/cordis/lib/index.js`), falling back to a
faithful replica of the cordis waterfall contract otherwise.
