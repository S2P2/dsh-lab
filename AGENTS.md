# dsh-lab

My [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) extension lab — reusable plugins, Agent presets, and supporting research.

> ⚠️ **Early experimental extensions.** Everything here is under active, unrestrained experimentation: APIs will break, behavior will change, and quality varies wildly between packages and presets. Use at your own risk — read the source before installing anything into a profile that holds your credentials.

## Why

Skills shape agent behavior through text; plugins add deterministic tools, UI, and runtime behavior; presets compose those capabilities into purpose-built agents. Keep those layers together when they need to evolve together, but preserve clear artifact boundaries between reusable plugin packages and Agent compositions.

## Packages

| Package | Status | What |
|---|---|---|
| [`packages/dsh-grilling-card`](packages/dsh-grilling-card) | 🌱 v0.1 · dogfooding | Rich grilling/interview question card: recommended answers, one-click accept, round-at-a-time, frontier meter, recorded-round transcript view. Dual-face plugin (host `grill_round` tool + composer-takeover card). |
| [`packages/dsh-ask-card`](packages/dsh-ask-card) | 🌱 early | Richer transcript view for stock `ask_user_question`: stock shows the question and recorded answer; this plugin adds offered options, recommendations, selections, custom answers, multi-select state, and status context. Expanded cards use more vertical space than stock; collapsed behavior stays stock-like. |
| `packages/dsh-wayfinder-map` | planned | Decision-ticket map with blocking edges (wayfinder visualization). |
| `packages/dsh-frontier` | planned | Deterministic implement-spec orchestrator: ticket graph, frontier computation, approval-gated destructive ops. |
| `packages/dsh-quota-bar` | 🌱 dogfooding | GLM Coding Plan quota card: 5h/weekly/tools windows + reset times in the sidebar footer, host-side fetch over a loopback route. Dock-bar form retired after dogfooding (too distracting); prototype on `prototype/quota-bar-slots`. |

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

### Releases

Changesets version the packages. A PR that changes anything under `packages/` adds a changeset in the same PR (`pnpm changeset`). Merging to `main` keeps the auto-maintained "Version Packages" PR updated; merging that bumps versions, writes `CHANGELOG.md` files, and tags. Tags only for now — npm publishing flips on with the first shipped package.

Agent presets under `presets/` are not npm packages and do not require Changesets unless a PR also changes a package.

## Layout

```
packages/<dsh-*>   one npm package per reusable plugin
presets/<id>/      one filesystem Agent preset per immediate child directory
shared/            code shared across plugins
.dsh/              dogfooding: skills + profile bits for working on this repo
```

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in this repo, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map to same-named GitHub labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Agent conventions

### DSH plugin prior art

Researching, designing, or materially changing a DSH plugin: use `docs/agents/dsh-plugin-landscape.md` as the ecosystem map for existing plugin categories, boundaries, recurring shapes, and adjacent prior art.

### DSH Agent presets

Use `presets/<id>/` for Agent compositions; keep `packages/` reserved for independently installable plugins. Each immediate child of `presets/` must be a self-contained preset directory with `agent.cordis.yml` and may contain `preset.yml`, preset-local Skills, and other preset-owned assets.

Do not commit secrets to presets. API keys, access tokens, passwords, cookies, and other credentials belong in the Host/profile credential system. A public preset may reference capabilities that require credentials at runtime, but it must never embed the credential value.

Prefer the repository checkout as the source of truth during dogfooding. Point DSH at the repository's `presets/` root or copy an individual preset into the user preset root; avoid maintaining an untracked divergent copy by hand.

### AI-assisted content

Mark issues, PR descriptions, comments, and commit messages drafted by an AI agent with S2P2's AI-assisted markers. Do not mark source files or docs. See `docs/agents/ai-assisted-content.md`.

### Post-implementation verification

After implementation tasks, tell the human what manual testing is worth doing—only what automated tests cannot cover; otherwise say "skip". See `docs/agents/post-implementation-verification.md`.

### GitHub issue conventions

Chart and refresh Wayfinder maps as clickable Mermaid dependency graphs; use native sub-issues and S2P2's stable label palette. See `docs/agents/github-issue-conventions.md`.
