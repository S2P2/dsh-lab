# Agent preset repository organization

Researched 2026-08-27 to decide where S2P2's custom DSH Agent presets should live relative to [`dsh-lab`](https://github.com/S2P2/dsh-lab).

## Executive recommendation

**Keep presets in `dsh-lab`, but give them a separate top-level `presets/` tree. Do not put them under `packages/`, and do not create a second repository yet.**

The clean boundary is:

```text
dsh-lab/
├── packages/          # reusable, independently installable DSH plugins
├── presets/           # agent compositions
│   └── writing/
│       ├── agent.cordis.yml
│       ├── preset.yml
│       ├── skills/    # only if the preset owns/carries skills
│       └── ...        # other preset-owned assets if needed
├── docs/
└── ...
```

This changes `dsh-lab` from a narrowly named "plugin lab" into a broader **DSH extension lab**, while preserving the important distinction between distributable plugin packages and agent compositions.

A separate presets repository becomes worthwhile later only if presets acquire an independent audience, release cadence, distribution mechanism, or maintainer boundary.

## Evidence

### 1. `dsh-lab` is currently organized around npm plugin packages

The current README describes `dsh-lab` as a "plugin lab — pnpm monorepo, one package per plugin" and defines `packages/<dsh-*>` as one npm package per plugin. Releases are driven through Changesets and eventually npm publishing.

Sources:

- <https://github.com/S2P2/dsh-lab/blob/main/README.md>
- <https://github.com/S2P2/dsh-lab/blob/main/AGENTS.md>

This is a good boundary to preserve: `packages/` should keep meaning "package manager artifact" rather than becoming a generic bucket for every DSH customization.

### 2. DSH presets are filesystem compositions, not npm packages

The Harness defines an Agent preset as **a directory holding one `agent.cordis.yml`**. Preset discovery scans configured roots plus the user's `<dshHome>/.agent-presets` root. A preset can also carry `preset.yml`, skills, plugin files, and other local assets.

The roster supports arbitrary configured roots, so a development checkout can itself be a preset source; presets do not need npm packaging merely to be discovered by DSH.

Source:

- <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-presets/README.md>

### 3. DSH itself co-locates multiple shipped presets inside its main repository

The official Harness keeps its built-in presets together under:

```text
apps/cli/config/agent-presets/
├── code/
├── cordis/
├── minimal/
└── standard/
```

This is direct precedent for a repository containing code plus a dedicated collection of preset directories rather than requiring one repository per preset.

Sources:

- <https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/cli/config/agent-presets>
- <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/README.md>

### 4. Community prior art also combines plugins/runtime components and presets in one repository

`dsh-routing-suite` deliberately keeps its injector and its routing presets in one repository, using separate top-level directories (`injector/` and `preset/`) and an installation script that installs the plugin component and copies presets to `.dsh/.agent-presets`.

This is close to the likely `dsh-lab` use case: a preset may depend on custom plugins maintained alongside it, so keeping both under one repository makes coordinated changes and dogfooding easier.

Source:

- <https://github.com/yjh051108/dsh-routing-suite/blob/main/README.en.md>

### 5. Presets have a different distribution lifecycle from plugins

DSH Desktop's `.dshpreset` format packages a preset directory (composition, optional metadata, skills/plugins/assets) as its own transfer artifact. That reinforces that presets have a lifecycle separate from npm plugin packages even when they live in the same source repository.

Source:

- <https://github.com/dataelement/dsh-desktop/blob/main/docs/preset-packages.md>

## Options compared

| Option | Fit now | Advantages | Costs / risks |
|---|---|---|---|
| **A. Keep in `dsh-lab` under `presets/`** | **Best** | One issue tracker; coordinated plugin+preset changes; simple dogfooding; one source of truth; no cross-repo dependency bookkeeping | README/AGENTS identity must broaden beyond "plugin lab"; release automation must explicitly ignore presets |
| **B. Create `dsh-presets` repository now** | Premature | Very clean artifact boundary; independent history/releases; easier to present as a public preset catalog | More repos, duplicated docs/conventions, cross-repo issues/PRs when a preset depends on a `dsh-lab` plugin, extra sync/install work |
| **C. Umbrella repo plus separate component repos/submodules** | Overbuilt | Maximum independence and composability | Highest maintenance cost; submodule/mirroring/version coordination solves problems that do not exist yet |

Decision: **Adapt the existing repository into a broader DSH extension lab.** Keep artifact boundaries inside the repo rather than at the Git repository boundary.

## Recommended boundaries inside `dsh-lab`

### `packages/` — reusable plugins

Keep a component here when it is intended to be independently installed into a DSH profile, versioned, tested, and potentially published to npm.

Examples:

```text
packages/dsh-quota-bar/
packages/dsh-grilling-card/
packages/dsh-web-search-router/
```

### `presets/` — agent compositions

Each immediate child is one DSH preset directory:

```text
presets/
├── writing/
│   ├── agent.cordis.yml
│   ├── preset.yml
│   └── skills/
├── research/
│   ├── agent.cordis.yml
│   └── preset.yml
└── coding-s2p2/
    ├── agent.cordis.yml
    └── preset.yml
```

Do not place another organizational directory between `presets/` and the actual preset IDs if this directory itself will be used as a DSH preset root; Harness discovery treats each immediate child directory as a preset ID.

### Preset-owned assets vs shared plugins

Use this rule:

- **Reusable plugin with its own lifecycle:** `packages/`.
- **Agent composition choosing tools/plugins/prompt:** `presets/<id>/agent.cordis.yml`.
- **Tiny plugin/file used only by one preset and meant to travel with it:** may live inside `presets/<id>/`, because relative plugin paths resolve from the preset directory.
- **Preset-specific skills/assets:** may live inside the preset directory when the composition explicitly exposes them.

Harness resolves bare package specifiers from the Host composition, while relative paths resolve from the preset's own directory. Therefore merely keeping a plugin and a preset in the same Git repository does **not** automatically install that plugin into the DSH Host. A preset that names `@s2p2/dsh-foo` still requires the Host/profile to have that package available, unless the preset deliberately uses a relative preset-owned plugin file.

Source:

- <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-presets/README.md#how-a-presets-rows-resolve>

## Development and dogfooding model

Prefer the Git checkout as the source of truth, rather than manually editing only `~/.dsh/.agent-presets`.

Two practical ways to dogfood:

1. **Configured preset root:** point the Harness AgentPresets `roots` configuration at `<checkout>/presets`. This gives immediate discovery from the repository and avoids copy drift.
2. **Install/sync command:** copy or symlink individual preset directories into `<dshHome>/.agent-presets` when a configured development root is inconvenient. If this becomes repetitive, add a small repository script rather than maintaining copies manually.

The first model is cleaner for development because Harness re-reads preset roots and recognizes file changes for new sessions.

## Versioning

Do **not** put presets into the existing Changesets/npm release flow by default.

Recommended initial policy:

- plugins: keep semantic package versions and Changesets;
- presets: version through Git history and document DSH/plugin compatibility in the preset README or metadata where useful;
- coordinated changes: one PR can update `packages/...` and `presets/...` atomically.

If presets later need downloadable releases, introduce a preset-specific packaging/release step (for example `.dshpreset` artifacts) without forcing them into npm.

## When to split into a second repository

Split `presets/` into something like `dsh-presets` only when one or more of these become true:

1. Presets are useful to people who do not need or want the `dsh-lab` plugin source tree.
2. Presets need independent tags/releases/download artifacts on a different cadence.
3. The repository grows large enough that plugin and preset issue/PR traffic interfere with each other.
4. Presets gain separate maintainers or a materially different contribution/security policy.
5. A stable public preset catalog becomes a product in its own right.

Until then, a second repository adds coordination cost without solving a current boundary problem.

## Concrete next step

Add a top-level `presets/` directory and make the first preset:

```text
presets/writing/
├── agent.cordis.yml
├── preset.yml
└── README.md
```

Then update the repository's README/AGENTS opening description from "plugin lab" to a broader description such as "personal DeepSeek Harness extension lab — plugins, Agent presets, and supporting research." Keep `packages/` semantics unchanged.

This is a small, reversible expansion: if presets later deserve their own repository, `presets/` is already a clean subtree that can be split with Git history preserved.