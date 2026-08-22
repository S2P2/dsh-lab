# dsh-lab

My [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin lab — pnpm monorepo, one package per plugin.

> ⚠️ **Early experimental plugins.** Everything here is under active, unrestrained experimentation: APIs will break, behavior will change, and quality varies wildly between packages. Use at your own risk — read the source before installing anything into a profile that holds your credentials, and pin exact versions if you depend on any of it.

## Why

Skills shape agent behavior through text; they can't register tools, render UI, or enforce anything deterministically. This lab is where those pieces live: workflow extensions around [Matt Pocock's skills](https://github.com/mattpocock/skills), quota/status widgets, and other experiments.

## Packages

| Package | Status | What |
|---|---|---|
| [`packages/dsh-quota-bar`](packages/dsh-quota-bar) | 🌱 v0.1.x · [spec #1](https://github.com/S2P2/dsh-lab/issues/1) (done) · [v0.2 settings #6](https://github.com/S2P2/dsh-lab/issues/6) | GLM Coding Plan quota card in the sidebar footer: 5h/weekly/tools windows + reset times in a theme-native card. Host-side fetch (credentials-service key resolution) over a loopback route; parser unit-tested. Port of proven pi-config statusline logic. |
| [`packages/dsh-grilling-card`](packages/dsh-grilling-card) | 🌱 scaffold · 📋 [spec #2](https://github.com/S2P2/dsh-lab/issues/2) | Rich grilling/interview question UI: recommended answers, one-click accept, round-at-a-time, frontier meter. Designed MCP-elicitation-compatible. |
| `packages/dsh-glossary` | 📋 [spec #3](https://github.com/S2P2/dsh-lab/issues/3) | Context glossary surfaces: term sidebar, chatbox autocomplete, avoid-list flagging with suggestions. |
| `packages/dsh-wayfinder-map` | 📋 [spec #4](https://github.com/S2P2/dsh-lab/issues/4) | Decision-ticket map with blocking edges (wayfinder visualization). |
| `packages/dsh-frontier` | 📋 [spec #5](https://github.com/S2P2/dsh-lab/issues/5) (blocked by #4) | Deterministic implement-spec orchestrator: ticket graph, frontier computation, approval-gated destructive ops. |

> **Spec status:** #1 is implemented and closed (grilled → prototyped → shipped 2026-08-22). #2–#5 are rough seeds from the 2026-08-22 planning session, labeled `needs-triage` — each needs a grilling round before it's `ready-for-agent` for implementation.

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

Note: pnpm 11+ gates freshly published packages behind `minimumReleaseAge` (24h default). For your own freshly-published packages set `minimumReleaseAge: 0` in the profile's `pnpm-workspace.yaml` (see [dsh-web-ui#71](https://github.com/zhu1090093659/dsh-web-ui/issues/71)).

## Layout

```
packages/<dsh-*>   one npm package per plugin
docs/research/     primary-source research notes feeding the specs
CONTEXT.md         domain glossary for the lab's contexts
shared/            code shared across plugins (planned)
.dsh/              dogfooding: skills + profile bits for working on this repo (planned)
```
