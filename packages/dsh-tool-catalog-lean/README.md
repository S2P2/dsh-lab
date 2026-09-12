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

## Configuration

Three knobs reach the plugin through the plugin row's `config:` key —
extend the row in your profile's `cordis.patch.yml` (a patch row with the
same `id` sets `config` on the bundle-inserted entry):

```yaml
# <profile>/cordis.patch.yml
- id: dsh-tool-catalog-lean
  config:
    # 1. Enabled — default true whenever the row is present.
    #    An explicit false disables the rewrite entirely: the assembled
    #    catalog is byte-identical to stock (A/B comparison).
    enabled: true

    # 2. Overrides — per-tool description entries merging OVER the curated
    #    map, keyed by tool name. Same entry shape as curated entries;
    #    a whole-entry replacement per tool name (no per-property merge in
    #    v1). May replace a curated entry or add a new tool name.
    overrides:
      bash:
        description: Run a bash command in a fresh shell; exits report as markers.
        parameters:
          properties:
            timeoutMs: Kill the command after this many milliseconds.
      mcp__acme__widget:
        description: Fetch an Acme widget.

    # 3. Diagnostics — default false. When true, one log line per assembly
    #    through the host logger, e.g.
    #    `tool-catalog-lean: 23 tools, 21062 -> 19790 chars`.
    #    Never alters the delivered catalog.
    diagnostics: false
```

Notes:

- Every key is optional; omitting `config` entirely means fully enabled,
  curated map as shipped, diagnostics off.
- Override entries only replace `description` strings that already exist
  in the stock schema — the transform never adds fields, so the
  descriptions-only safety invariant holds for overrides too.
- The merged map is computed once at plugin start, deterministically —
  no per-assembly variation, so prefix-cache stability is unaffected.

Note: pnpm 11+ gates freshly published packages behind `minimumReleaseAge`
(24h default); set `minimumReleaseAge: 0` in the profile's
`pnpm-workspace.yaml` for your own fresh packages.

## Status

🌱 tracer bullet + config (#79, #81 of spec #77): only `bash` is curated so
far — its 2,717 description characters (tool-level + parameter-level, the
largest definition in the catalog) compress to roughly half while a
checklist test pins every safety fact (fresh shell, exit-code marker,
sandbox-denial marker, one-shot escalation with justification, background
jobs via job id, tail truncation). The plugin row accepts config
(`enabled`, `overrides`, `diagnostics` — see Configuration). The full
curated map for the remaining stock tools lands in #80.

Tests (`npm test`, no dependencies) run against the captured 23-tool stock
catalog committed under `test/fixtures/`, including a safety invariant that
strips every description from original and projected catalogs and asserts
deep equality, pass-through and determinism checks, config-surface tests
(enabled/overrides/diagnostics through the public seam), and an integration
test that mounts the listener through a real `@deepseek-ai/cordis`
waterfall when one is importable (see `test/helpers.js` for the lookup,
override with `DSH_TEST_CORDIS_ENTRY=/path/to/cordis/lib/index.js`),
falling back to a faithful replica of the cordis waterfall contract
otherwise.
