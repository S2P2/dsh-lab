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

## Status

🌱 tracer bullet (#79 of spec #77): only `bash` is curated so far — its
2,717 description characters (tool-level + parameter-level, the largest
definition in the catalog) compress to roughly half while a checklist test
pins every safety fact (fresh shell, exit-code marker, sandbox-denial
marker, one-shot escalation with justification, background jobs via job id,
tail truncation). The full curated map for the remaining stock tools lands
in #80; config (enable/disable, preset overrides, diagnostics) in #81.

Tests (`npm test`, no dependencies) run against the captured 23-tool stock
catalog committed under `test/fixtures/`, including a safety invariant that
strips every description from original and projected catalogs and asserts
deep equality, pass-through and determinism checks, and an integration test
that mounts the listener through a real `@deepseek-ai/cordis` waterfall when
one is importable (see `test/helpers.js` for the lookup, override with
`DSH_TEST_CORDIS_ENTRY=/path/to/cordis/lib/index.js`), falling back to a
faithful replica of the cordis waterfall contract otherwise.
