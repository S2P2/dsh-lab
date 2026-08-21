# dsh-lab

My [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin lab — pnpm monorepo, one package per plugin.

## Why

Skills shape agent behavior through text; they can't register tools, render UI, or enforce anything deterministically. This lab is where those pieces live: workflow extensions around [Matt Pocock's skills](https://github.com/mattpocock/skills), quota/status widgets, and other experiments.

## Packages

| Package | Status | What |
|---|---|---|
| [`packages/dsh-grilling-card`](packages/dsh-grilling-card) | 🌱 scaffold | Rich grilling/interview question UI: recommended answers, one-click accept, round-at-a-time, frontier meter. Designed MCP-elicitation-compatible. |
| `packages/dsh-wayfinder-map` | planned | Decision-ticket map with blocking edges (wayfinder visualization). |
| `packages/dsh-frontier` | planned | Deterministic implement-spec orchestrator: ticket graph, frontier computation, approval-gated destructive ops. |
| `packages/dsh-quota-bar` | idea | GLM Coding Plan quota/status bar. |

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
dsh plugin --profile web add ../dsh-lab/packages/dsh-grilling-card
```

Note: pnpm 11+ gates freshly published packages behind `minimumReleaseAge` (24h default). For your own freshly-published packages set `minimumReleaseAge: 0` in the profile's `pnpm-workspace.yaml` (see [dsh-web-ui#71](https://github.com/zhu1090093659/dsh-web-ui/issues/71)).

## Layout

```
packages/<dsh-*>   one npm package per plugin
shared/            code shared across plugins
.dsh/              dogfooding: skills + profile bits for working on this repo
```
