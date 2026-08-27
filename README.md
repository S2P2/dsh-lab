# dsh-lab

My [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) extension lab — reusable plugins, Agent presets, and supporting research.

> ⚠️ **Early experimental extensions.** Everything here is under active, unrestrained experimentation: APIs will break, behavior will change, and quality varies wildly between packages and presets. Use at your own risk — read the source before installing anything into a profile that holds your credentials, and pin exact plugin versions if you depend on any of it.

## Why

Skills shape agent behavior through text; plugins add deterministic tools, UI, and runtime behavior; presets compose those capabilities into purpose-built agents. This lab keeps those layers together when they need to evolve together, while preserving clear artifact boundaries between plugins and presets.

## Packages

| Package | Status | What |
|---|---|---|
| [`packages/dsh-quota-bar`](packages/dsh-quota-bar) | 🌱 v0.1.x · [spec #1](https://github.com/S2P2/dsh-lab/issues/1) (done) · [v0.2 settings #6](https://github.com/S2P2/dsh-lab/issues/6) | GLM Coding Plan quota card in the sidebar footer: 5h/weekly/tools windows + reset times in a theme-native card. Host-side fetch (credentials-service key resolution) over a loopback route; parser unit-tested. Port of proven pi-config statusline logic. |
| [`packages/dsh-grilling-card`](packages/dsh-grilling-card) | 🌱 v0.1 · [spec #2](https://github.com/S2P2/dsh-lab/issues/2) (implemented, dogfooding) | Rich grilling/interview question card: recommended answers, one-click accept, round-at-a-time, frontier meter, recorded-round transcript view. Dual-face (host `grill_round` tool + composer-takeover card); round-trip, wire-legality, and MCP-elicitation tests. |
| [`packages/dsh-ask-card`](packages/dsh-ask-card) | 🌱 early · dogfooding | Rich transcript card for the stock `ask_user_question` tool: shadows the `tool.call.toolview` row at priority -1 — pixel-identical stock look collapsed, question/answer card expanded (choices, recommendations, multi-select, status chip; stock IN/OUT fallback). Client-only; uninstall restores stock. |
| `packages/dsh-glossary` | 📋 [spec #3](https://github.com/S2P2/dsh-lab/issues/3) | Context glossary surfaces: term sidebar, chatbox autocomplete, avoid-list flagging with suggestions. |
| `packages/dsh-wayfinder-map` | 📋 [spec #4](https://github.com/S2P2/dsh-lab/issues/4) | Decision-ticket map with blocking edges (wayfinder visualization). |
| `packages/dsh-frontier` | 📋 [spec #5](https://github.com/S2P2/dsh-lab/issues/5) (blocked by #4) | Deterministic implement-spec orchestrator: ticket graph, frontier computation, approval-gated destructive ops. |

> **Spec status:** #1 is implemented and closed (grilled → prototyped → shipped 2026-08-22). #2 is implemented (grilled → prototyped → built 2026-08-23, dogfooding). #3–#5 are rough seeds from the 2026-08-22 planning session, labeled `needs-triage` — each needs a grilling round before it's `ready-for-agent` for implementation.

## Presets

Custom Agent presets live under [`presets/`](presets/), one immediate child directory per preset id. Presets are source-controlled compositions, not npm packages, and must not contain API keys, tokens, passwords, or other secrets. Host/profile credentials stay outside the preset and are resolved at runtime.

The first scaffold is [`presets/writing`](presets/writing): a deliberately small writing-focused Agent composition with file/search, web, questions, and preset-local Skills, but no shell, coding workflows, or subagents.

## Install (once packages publish)

```sh
dsh plugin --profile web add @s2p2/<package>
```

Then restart `dsh web`.

## Development

```sh
pnpm install
pnpm build
# dogfood: link a package into your web profile
dsh plugin --profile web add ../dsh-lab/packages/dsh-quota-bar
```

For preset development, point a DSH Agent preset root at this checkout's `presets/` directory, or copy an individual preset into `$DSH_HOME/.agent-presets/`. Keep the Git checkout as the source of truth.

Note: pnpm 11+ gates freshly published packages behind `minimumReleaseAge` (24h default). For your own freshly-published packages set `minimumReleaseAge: 0` in the profile's `pnpm-workspace.yaml` (see [dsh-web-ui#71](https://github.com/zhu1090093659/dsh-web-ui/issues/71)).

Releases run through changesets: `pnpm changeset` in package-changing PRs, merge the auto-maintained "Version Packages" PR, and the Release workflow bumps versions, writes CHANGELOGs, and tags. npm publishing flips on (`pnpm changeset publish` + `NPM_TOKEN`) when the first package ships. Presets are not part of the Changesets/npm release flow.

## Layout

```
packages/<dsh-*>   one npm package per reusable plugin
presets/<id>/      one filesystem Agent preset per immediate child directory
docs/research/     primary-source research notes feeding the specs
CONTEXT.md         domain glossary for the lab's contexts
shared/            code shared across plugins (planned)
.dsh/              dogfooding: skills + profile bits for working on this repo (planned)
```
