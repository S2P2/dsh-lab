# DSH plugin marketplaces, registries, and publishing conventions

Researched 2026-08-29 as a follow-up to [`docs/agents/dsh-plugin-landscape.md`](../agents/dsh-plugin-landscape.md). That existing document remains the semantic map for plugin prior art and categories. This note answers a different question: **how DSH plugins are packaged, distributed, discovered, listed, verified, and installed across the current ecosystem**.

The main conclusion is that there is **no single DSH marketplace layer**. The ecosystem is a stack of independent mechanisms:

```text
plugin source/package
    |
    |  DSH bundle contract
    v
DSH installability ---------------------- official DeepSeek Harness
    |
    +--> npm / Git / tarball ------------ package distribution
    |
    +--> GitHub dsh-plugin topic -------- broad discovery substrate
    |        |
    |        +--> topic mirrors / storefronts
    |        +--> automated registries
    |        +--> verification overlays
    |
    +--> curated PR catalogs ------------ human review / editorial curation
    |
    +--> source-backed registries -------- pinned metadata / install helpers
```

A site calling itself a marketplace may therefore own only discovery or presentation. The underlying install is still normally the native `dsh plugin --profile <name> add <spec>` flow over npm, Git, or a tarball.

## Executive findings

1. **DeepSeek Harness itself defines plugin installability, not marketplace membership.** The first-party packaging guide defines an installable bundle as a package whose `package.json` declares `dsh.bundle`, normally with `dsh.bundle.patch` pointing to `cordis.patch.yml`. `dsh plugin` installs the package into a profile and adds the bundle layer to that profile. A package without `dsh.bundle` can be installed only as a dependency and does not activate a bundle layer. [Source: DeepSeek Harness `publish.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)

2. **npm is optional.** First-party DSH supports local packages, Git-hosted packages, npm packages, and tarballs. Git installs are less frictionless when a package needs a build: the author must provide a self-contained `prepare` path and pnpm >=10 requires the user to authorize that install-time build. Prebuilt npm packages or tarballs avoid that build-authorization step. The official guide also recommends pinning a trusted Git commit when install-time code may run. [Source: DeepSeek Harness `publish.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)

3. **`dsh-plugin` is the de facto ecosystem discovery topic, not a DSH installability requirement found in first-party packaging docs.** Multiple independent catalogs consume the GitHub topic, including DSHBase, dsh.so, dsh.pub, dshmarketplace.dev, DSH Directory, and topic-only mirrors. `awesome-dsh-plugin` also requires the topic for its own submissions. The current DeepSeek Harness packaging guide does not make the topic part of the bundle contract. Treat it as a high-value community publishing convention, not as part of the runtime ABI. [Sources: DSH packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), [awesome-dsh-plugin contribution guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md), [DSHBase directory](https://www.dshbase.com/plugins/directory/), [dsh.so](https://www.dsh.so/), [dsh.pub source](https://github.com/dsh-pub/dsh-pub), [dshmarketplace.dev submission guide](https://dshmarketplace.dev/submit), [DSH Directory](https://dsh.directory/)]

4. **DSHBase is not the package registry.** It identifies itself as an independent, unaffiliated community resource. Its plugin directory states that its data is merged from the GitHub `dsh-plugin` topic and dsh.so; DSHBase adds its own install/load/runtime/web verification evidence and badges on top. The original repositories/npm packages remain the distribution source. [Sources: DSHBase home](https://www.dshbase.com/), [directory](https://www.dshbase.com/plugins/directory/)]

5. **The strongest human-curated listing gate found is `awesome-dsh-plugin`.** Its source of truth is one YAML file per plugin under `data/plugins/`. Submissions are PR-based and require a real `dsh.bundle`, working code, a repository at least one day old with at least ten commits, active maintenance, the `dsh-plugin` topic, and an accurate non-marketing description. CI checks mechanical requirements, then a maintainer reads the target repository for claim accuracy, duplication, category fit, and obvious source-level red flags. The project explicitly says this is not a security audit or endorsement. [Source: `awesome-dsh-plugin` contribution guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)

6. **dsh.pub is the clearest registry + installer combination, but it still does not own plugin source distribution.** Its catalog pins public Git commits; its `dshpub` CLI validates the selected bundle and then delegates to native `dsh plugin`. Browser submissions create auditable PRs through a GitHub App, while a daily `dsh-plugin` topic sync also discovers candidates. The submission pipeline validates committed bundle structure without executing third-party code. [Sources: dsh.pub](https://dsh.pub/en/), [dsh-pub/dsh-pub README](https://github.com/dsh-pub/dsh-pub)]

7. **A listing badge is not a universal compatibility/security claim.** The current surfaces intentionally use different meanings: DSHBase runs installation/runtime checks, dsh.so exposes staged verification levels and automated security signals, dsh.pub validates a pinned static bundle contract without running submitted code, DSH Directory performs static bundle detection, and DSH Plugin Registry distinguishes ordinary indexed entries from version-specific Runtime Verified evidence. Those labels should not be compared as if they were the same certification. [Sources: DSHBase directory](https://www.dshbase.com/plugins/directory/), [dsh.so](https://www.dsh.so/), [dsh.pub source](https://github.com/dsh-pub/dsh-pub), [DSH Directory about](https://dsh.directory/about), [DSH Plugin Registry](https://dshplugin.app/)]

## Comparison matrix

| Surface | Role | Metadata / source of truth | How plugins get listed | Distribution backend | Required conventions | Review / quality gates | Install experience | Status / maintenance snapshot |
|---|---|---|---|---|---|---|---|---|
| **DeepSeek Harness / `dsh plugin`** | Runtime installability and profile composition; not a marketplace | Plugin package + `package.json`; profile manifest maintained by DSH | Not applicable | npm, Git, local path, tarball via pnpm-backed profile install | Installable bundle declares `dsh.bundle.patch`; committed patch must reference loadable package code | Runtime/package validation, not ecosystem curation | Native `dsh plugin --profile <name> add <spec>` | **First-party authority** for bundle/profile mechanics; current packaging guide checked 2026-08-29 |
| **GitHub `dsh-plugin` topic** | Broad discovery substrate | GitHub repository metadata | Repository owner adds topic | Whatever the repository documents | No DSH-specific structural gate inherent in the topic | None inherent | Usually repository link only | Widely consumed by community catalogs; **community convention**, not established here as first-party DSH requirement |
| **`awesome-dsh-plugin`** | Curated community catalog / index | `data/plugins/*.yml` + linked repository | One-file PR or maintainer editorial addition | Repo/npm/tarball information from upstream entry/repository | `dsh.bundle`, real code, `dsh-plugin` topic, factual description, category; optional release tarball; npm recommended | CI + human maintainer repository review; age >=1 day; >=10 commits; maintenance; duplicate/source sanity checks | Generated catalog points users/storefronts at installable source | Active community catalog; taxonomy is explicitly editorial and evolves |
| **DSHBase** | Aggregated discovery + its own runtime verification/badges | Directory says GitHub `dsh-plugin` topic + dsh.so merge; DSHBase owns its test results | Broad aggregation rather than a narrow publish gate; plugin authors can surface evidence/badges | Original npm/Git source | No separate DSHBase package format observed | L1-L3 headless tests and L4 web CDP when applicable on the currently stated test baseline; static-security status shown separately | Copyable native DSH install commands; badges link to test state | Independent/unaffiliated; directory snapshot dated 2026-08-26; named operator not established from the public first-party pages reviewed |
| **dsh.so** | Trust, verification, health, and discovery registry | Aggregated public GitHub + npm data plus dsh.so verification/security state | `dsh-plugin` topic auto-discovery or explicit submission | Original npm/Git source | Repository/manifest/install metadata sufficient for its verification stages | Public L1-L5 model; current site says automated verification is exercised through install-tested L4, plus automated dependency/permission/secret/supply-chain scans | Copyable native `dsh plugin` command | Independent/unaffiliated; site showed registry/security refresh on 2026-08-27 |
| **dsh.pub** | Source-backed registry, built-in catalog, submission system, commit-pinned installer | Pinned Harness snapshot for built-ins; pinned public Git commits + checked-in registry/submission data for community bundles | Browser submission -> GitHub App PR -> automated validation/merge; also daily `dsh-plugin` topic sync | Public Git commit; `dshpub` delegates successful install to native DSH | Public package with committed valid `dsh.bundle.patch`; required files such as patch/runtime entry plus metadata/documentation used by its gates | Automated static contract checks from pinned source; submission validation does **not** execute third-party code; listing is not security/runtime/identity endorsement | `npx dshpub add owner/repo ...`; exact commit is resolved/pinned, then native DSH install runs | Active source repository and live registry; daily topic sync documented in project README |
| **DSH Directory (`dsh.directory`)** | Static-contract directory | GitHub remains source of truth; directory stores resolved package/check evidence | Operator-provided candidates + `dsh-plugin` auto-discovery; separate structured issue submission workflow exists | Original documented npm/Git spec | Public repo; exact package path; `package.json` at path; `dsh.bundle.patch`; patch exists; factual description/install command for form submissions | Static bundle contract only; explicitly not security or compatibility certification | Copy exact upstream/documented install command | Independent community project; current site records last-checked evidence per plugin |
| **dshmarketplace.dev** | Topic-driven storefront with web/API/client surfaces and optional curated signal | GitHub topic metadata; repository content; curated marker delegated to `awesome-dsh-plugin` | Mostly automatic next-sync listing after adding `dsh-plugin`; corrections/submissions can be handled separately | npm when available, otherwise repository source | For good listing: useful repo description, license, README/install docs; npm improves install path | Topic listing itself is broad; curated status is a separate `awesome-dsh-plugin` review path | Copy/install-oriented storefront; npm preferred when published | Independent site; submission guide reviewed 2026-08-29 |
| **DSH Plugin Registry (`dshplugin.app`)** | Evidence-oriented registry + in-DSH discovery UI | Public repositories plus registry analysis/classification/evidence | Topic ecosystem indexing + structured submissions; publication pipeline performs inspection/classification/policy review | Original documented package/Git source; UI copies install command rather than auto-executing it | Valid source/package evidence and install information sufficient for registry publication | Source/security signals shown separately; `Indexed` is not `Runtime Verified`; runtime verification is version-specific evidence | Web registry + read-only/copy-install in-DSH surface | Active public registry; in-DSH plugin described as pre-release in its repository at time checked |
| **`dsh-plugin.io`** | Lightweight topic mirror / browsing directory | GitHub `dsh-plugin` topic | Automatic topic sync | Repository source | Topic membership | No separate installability/security gate established | Opens repository; browsing/filtering only | Catalog page stated sync date 2026-08-20 |

### What is deliberately not in the matrix

There is a long tail of additional catalogs and marketplace plugins, including sites such as `dshplugin.org`, `deepseekplugin.org`, `deepseekplugins.org`, `dsh-plugins.net`, and multiple installable in-DSH marketplace bundles. They are useful discovery surfaces, but most mechanics collapse into one of the patterns above: **topic mirror**, **source-backed static registry**, **curated PR list**, **verification overlay**, or **in-DSH manager backed by one of those data sources**. A new `dsh-lab` plugin should not require bespoke coupling to every storefront.

Representative sources: [dshplugin.org](https://dshplugin.org/), [deepseekplugin.org](https://deepseekplugin.org/en/plugins), [deepseekplugins.org](https://deepseekplugins.org/plugins), [dsh-plugins.net](https://dsh-plugins.net/).

## Layer-by-layer ecosystem map

### 1. Package distribution

**Authoritative mechanism:** the DSH CLI/profile packaging model, not a marketplace.

First-party DSH explicitly supports distribution without a registry publication requirement:

- npm package with prebuilt output;
- Git source, including a pinned commit;
- tarball produced by `pnpm pack`;
- local/link development package.

A marketplace may provide a better command or choose a preferred source, but the actual package is still resolved through the profile's package manager and native DSH bundle layer. [Source](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)

**Implication for `dsh-lab`:** npm is a convenience/distribution choice, not the definition of a plugin. For stable public plugins, npm is still the preferred default because it avoids the Git `prepare` + `allowBuilds` friction when the published artifact is prebuilt.

### 2. DSH installability

A persistent/package plugin intended to be enabled in a profile should expose the bundle contract:

```jsonc
{
  "name": "example-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

with a committed patch such as:

```yaml
- insert:
    - id: example
      name: example-plugin
```

`dsh.client` may be added when browser UI is shipped, but `awesome-dsh-plugin` explicitly calls out the common mistake of declaring only `dsh.client`: that is not an installable profile bundle by itself. [Sources: DSH packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), [awesome-dsh-plugin contribution guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)

### 3. Discovery / indexing

The `dsh-plugin` GitHub topic is the strongest common denominator across independent discovery systems.

Observed consumers include:

- DSHBase's merged directory;
- dsh.so automatic discovery;
- dsh.pub daily topic synchronization;
- dshmarketplace.dev;
- DSH Directory;
- `dsh-plugin.io`;
- numerous in-DSH marketplace/manager plugins.

This makes adding the topic the lowest-cost way to propagate a repository across the ecosystem. It does **not** make the topic an installability or trust gate.

### 4. Curation / review

There are three materially different review models:

- **Human-curated:** `awesome-dsh-plugin` uses CI as a precondition and a maintainer reads the repository before merge. It checks claim accuracy, working code, duplication, maintenance, and obvious suspicious source behavior. [Source](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
- **Automated runtime/verification:** DSHBase and dsh.so attach stronger machine-generated evidence to broad listings. Their verification levels are not identical and should be read according to each site's methodology. [DSHBase](https://www.dshbase.com/plugins/directory/), [dsh.so](https://www.dsh.so/)
- **Automated static contract:** dsh.pub and DSH Directory establish that a pinned/current source tree matches an installable bundle contract without claiming a runtime/security audit. [dsh.pub source](https://github.com/dsh-pub/dsh-pub), [DSH Directory about](https://dsh.directory/about)

### 5. Install UI

Install UX ranges from a copied command to an actual in-DSH manager. The important boundary is whether the surface itself performs package resolution or delegates to native DSH.

- DSHBase, dsh.so, and DSH Directory mainly expose/copy native DSH commands.
- dsh.pub's `dshpub` CLI does extra source resolution/validation/pinning, then delegates to native DSH.
- In-DSH marketplace plugins may invoke `dsh plugin` on the user's behalf after selection/consent.
- DSH Plugin Registry's published repository says its in-DSH UI intentionally does **not** automatically execute install commands; it provides discovery/evidence and copyable commands. [Source](https://github.com/dshplugin-app/dsh-plugin-registry)

## DSHBase specifically

### What it is

DSHBase is best classified as an **independent discovery aggregator + verification overlay + editorial guide**, not as the canonical package registry.

Evidence:

- The site footer explicitly says it is an unofficial community resource and not affiliated with DeepSeek. [Source](https://www.dshbase.com/)
- The directory identifies its data source as a merge of the GitHub `dsh-plugin` topic and the dsh.so catalog. [Source](https://www.dshbase.com/plugins/directory/)
- Individual plugin pages expose install commands pointing to original npm/Git sources and attach DSHBase-specific verification/security state. [Example](https://www.dshbase.com/plugins/dsh-files-git/)

### What “verified” means there

At the 2026-08-29 review, the directory described its current methodology as:

- L1-L3 headless checks on DSH `0.1.0-rc.6`;
- L4 web CDP when the L3 target is web-only;
- separate pending/failure and static-security status.

The version matters. A DSHBase badge is evidence against its stated test baseline, not a timeless compatibility guarantee for future DSH releases. [Source](https://www.dshbase.com/plugins/directory/)

### Who operates it

The public first-party pages reviewed establish only that it is an **independent community resource**. They did not establish a specific named operator/organization with enough confidence to record as authoritative. Keep that field as unknown rather than inferring ownership from surrounding ecosystem identities.

## `awesome-dsh-plugin` publishing convention

This is the most consequential marketplace-specific convention for `dsh-lab` because it adds a real human-curated discovery path.

A submission adds one record such as:

```yaml
url: https://github.com/owner/repo
name: owner/repo
category: ui
description:
  en: One factual sentence ending with a period.
  zh: 可选中文描述。
```

The catalog source of truth is `data/plugins/*.yml`; generated READMEs are not edited manually. [Source](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)

Current submission requirements include:

- real `dsh.bundle` in package metadata;
- real working code, not a placeholder/README-only repository;
- repository age of at least one day;
- at least ten commits;
- active maintenance;
- `dsh-plugin` topic;
- factual, non-promotional description that matches the code;
- reasonable primary category.

CI verifies mechanical shape; maintainer review checks actual claims, duplicate coverage, category, working code, and obvious source red flags. Listing is explicitly not a security audit or quality endorsement. [Source](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)

For a better install experience, its guide recommends either a prebuilt npm package or, when npm is not used, a prebuilt GitHub Release tarball referenced by the optional catalog `tarball` field. That aligns with the first-party DSH guidance to avoid unnecessary Git build authorization. [Sources: `awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md), [DSH packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)

## dsh.pub publishing convention

`dsh.pub` is intentionally source-backed and commit-pinned.

Its public repository documents two community ingestion paths:

1. **Browser submission.** A public GitHub URL is submitted. A Cloudflare workflow and repository-scoped GitHub App create/find an auditable `submissions/*.json` PR. Trusted Actions read the exact PR commit, resolve the plugin repository's public default-branch commit, validate the committed bundle contract, and merge passing submissions. Plugin code is not executed during that validation.
2. **Daily topic synchronization.** Repositories carrying `dsh-plugin` are snapshotted, pinned to public default-branch commits, and checked for a root bundle contract. Accepted/rejected analysis is recorded without treating topic membership itself as proof of installability.

The `dshpub` CLI then resolves an exact public ref, validates the selected package's `dsh.bundle.patch`, removes its validation checkout, and passes a persistent commit-pinned Git spec to native `dsh plugin`. [Source: dsh-pub/dsh-pub](https://github.com/dsh-pub/dsh-pub)

**Implication:** no dsh.pub-specific runtime manifest is needed in the plugin. Clean public Git source and the normal DSH bundle contract are the important parts; the registry adds its own checked-in submission metadata and pinning.

## DSH Directory publishing convention

DSH Directory's public contribution guide is deliberately narrower than a trust registry. A structured submission expects:

- public repository;
- exact plugin package directory on the current default branch;
- `package.json` directly inside that package directory;
- `dsh.bundle.patch` rather than `dsh.client` alone;
- the declared patch file inside the package directory;
- one-line factual description;
- one-line install command copied from the plugin's own documentation, with npm preferred when both npm and Git source installs are documented;
- one supported category.

Its automation re-checks open submissions over several days. Acceptance means the source matched its static bundle/listing rules, not runtime compatibility, security, or publisher ownership. [Source: `alexchenzl/dsh-plugin-directory` CONTRIBUTING](https://github.com/alexchenzl/dsh-plugin-directory/blob/master/CONTRIBUTING.md)

## Recommended publishing checklist for `dsh-lab`

This checklist separates **DSH correctness** from **ecosystem discoverability** so a future marketplace cannot accidentally become part of a plugin's runtime design.

### Tier 1 — valid DSH bundle: mandatory

- [ ] `package.json` has a stable package `name` and `version`.
- [ ] `package.json` declares `dsh.bundle.patch`.
- [ ] The declared `cordis.patch.yml` (or equivalent patch path) is committed and included in the distributed artifact.
- [ ] Patch rows resolve package entry points from the installed package; do not rely on a sibling monorepo checkout.
- [ ] Every runtime entry referenced by the patch is included in the published package/tarball or can be built through a documented, self-contained Git-install path.
- [ ] If browser UI is shipped, add the required `dsh.client` metadata, but never treat `dsh.client` alone as the installable bundle contract.
- [ ] Test `dsh plugin --profile <target> add <exact-spec>` in a disposable profile.
- [ ] Verify the resulting layer with `dsh --profile <target> --dump-config` before the runtime smoke test.

Primary authority: [DeepSeek Harness packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

### Tier 2 — distribution hygiene: default for public releases

- [ ] Prefer **prebuilt npm publication** for stable public plugins unless there is a reason not to. This removes the pnpm Git-build authorization step for users.
- [ ] If npm is not appropriate, attach a **prebuilt `.tgz`** to a GitHub Release.
- [ ] If Git-source install must build, provide a self-contained `prepare` script and document the pnpm `allowBuilds` consequence explicitly.
- [ ] For reproducible Git instructions, show a tag or commit-pinned variant, not only mutable `main`.
- [ ] Inspect `npm pack --dry-run` / the release tarball so bundle patch and runtime artifacts are actually present.
- [ ] Use normal SemVer releases and keep changelog/release notes clear enough to identify DSH compatibility changes.
- [ ] Include a license file.

Primary authorities: [DeepSeek Harness packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), [`awesome-dsh-plugin` contribution guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md).

### Tier 3 — common discovery metadata: default for every public `dsh-lab` plugin

- [ ] Add the GitHub topic **`dsh-plugin`**.
- [ ] Use a concise factual GitHub repository description; avoid rankings/superlatives.
- [ ] README explains the user-facing capability before implementation details.
- [ ] README contains exact install, update, and remove commands for the intended profile(s).
- [ ] README states current tested DSH version/range and platform/profile constraints.
- [ ] README documents configuration, environment variables/credentials, permissions, network/file/process access, install/build scripts, and telemetry when applicable.
- [ ] UI plugins include current screenshots, but screenshots remain documentation rather than a runtime/catalog dependency.
- [ ] Keep repository source, release artifacts, and README install commands mutually consistent.

These fields are repeatedly consumed by DSHBase, dsh.so, dsh.pub, dshmarketplace.dev, DSH Directory, DSH Plugin Registry, and topic mirrors.

### Tier 4 — curated ecosystem listing: recommended after the release is stable

Submit to [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin):

- [ ] repository has existed at least one day and has at least ten commits;
- [ ] project is actively maintained;
- [ ] `dsh-plugin` topic is present;
- [ ] one factual English description is ready; Chinese is optional;
- [ ] choose the closest current category;
- [ ] add only the plugin's own `data/plugins/<owner>__<repo>.yml` record and regenerate the generated READMEs according to upstream instructions;
- [ ] if npm is unavailable and source install is not clean, supply a prebuilt release tarball and catalog `tarball` value.

These are **`awesome-dsh-plugin` policy**, not DSH core requirements.

### Tier 5 — registry-specific optional submission

After the common metadata above is correct, additional reach is low-cost:

- **dsh.pub:** submit the public repository through its submission flow when immediate/auditable registry inclusion matters; otherwise its topic sync may discover a root bundle automatically. Ensure the public committed bundle contract is self-contained. [Source](https://github.com/dsh-pub/dsh-pub)
- **dsh.so:** add the topic for automatic discovery or submit the URL when verification should begin sooner. Its later verification/security state is owned by dsh.so, not by plugin metadata. [Source](https://www.dsh.so/)
- **DSH Directory:** use its issue form when structured package-path/category metadata matters, especially for nested packages. [Source](https://github.com/alexchenzl/dsh-plugin-directory/blob/master/CONTRIBUTING.md)
- **DSH Plugin Registry:** submit the public GitHub URL if the registry has not indexed it. Treat Runtime Verified evidence as a separate follow-up from basic indexing. [Source](https://dshplugin.app/)
- **DSHBase / topic storefronts:** no marketplace-specific manifest should be necessary; clean topic/source metadata and a valid installable bundle are the leverage points. DSHBase's own verification state can be earned independently. [Source](https://www.dshbase.com/plugins/directory/)

## What `dsh-lab` should *not* couple to

Do **not** add runtime dependencies on marketplace-specific metadata solely to improve listing coverage.

In particular:

- do not treat a DSHBase badge as a package requirement;
- do not treat dsh.so verification level as part of plugin versioning;
- do not make `awesome-dsh-plugin` category IDs part of plugin code/configuration;
- do not require dsh.pub's submission record at runtime;
- do not infer safety from any one marketplace's badge;
- do not assume every repository carrying `dsh-plugin` is installable;
- do not assume npm publication is mandatory;
- do not assume GitHub topic membership is a first-party DSH requirement.

The durable contract should remain **DSH bundle + package source + truthful repository documentation**. Marketplaces should be adapters around that source, not architectural dependencies.

## Proposed `dsh-lab` convention

For future public plugins, use this as the default release sequence:

```text
1. Build/test plugin in repo
2. Validate dsh.bundle + committed patch
3. Pack and inspect exact artifacts
4. Install exact artifact into disposable DSH profile
5. dump-config + runtime/UI smoke test
6. Publish prebuilt npm package (or release tarball)
7. Tag GitHub repo with dsh-plugin
8. Update factual README compatibility/install/security notes
9. Submit to awesome-dsh-plugin after maturity gate
10. Optionally submit to dsh.pub / dsh.so / DSH Directory / DSH Plugin Registry
11. Let topic-driven storefronts discover the same source automatically
```

This sequence maximizes compatibility with the important discovery surfaces while keeping marketplace-specific coupling near zero.

## Open questions and evidence limits

- **DSHBase operator identity:** the site establishes that it is independent/unaffiliated, but the public first-party pages reviewed did not establish a named legal/operator entity confidently enough to record one.
- **No first-party marketplace requirement found:** the current official packaging guide establishes bundle/profile/distribution mechanics but does not establish `dsh-plugin` topic membership or a canonical marketplace submission process. Some community sites describe a market or topic as “official”; those claims should not override first-party DSH docs without a matching first-party source.
- **Counts are intentionally omitted from durable conclusions.** Plugin counts and verification totals move daily and differ because surfaces have different inclusion rules. Where a current snapshot matters, query the target site directly.
- **Compatibility badges are versioned evidence.** For example, DSHBase's current methodology names a specific DSH release candidate. Re-check marketplace verification after significant DSH runtime changes rather than copying an old badge into compatibility claims.

## Primary sources

### First-party DSH

- [Package and install a plugin — DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness)

### Curated catalog

- [`awesome-dsh-plugin` contribution guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
- [`awesome-dsh-plugin` data source](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/tree/main/data/plugins)

### Discovery / registry surfaces

- [DSHBase](https://www.dshbase.com/)
- [DSHBase plugin directory](https://www.dshbase.com/plugins/directory/)
- [dsh.so](https://www.dsh.so/)
- [dsh.pub](https://dsh.pub/en/)
- [`dsh-pub/dsh-pub`](https://github.com/dsh-pub/dsh-pub)
- [dshmarketplace.dev submission guide](https://dshmarketplace.dev/submit)
- [DSH Directory](https://dsh.directory/)
- [DSH Directory about](https://dsh.directory/about)
- [`alexchenzl/dsh-plugin-directory` contribution guide](https://github.com/alexchenzl/dsh-plugin-directory/blob/master/CONTRIBUTING.md)
- [DSH Plugin Registry](https://dshplugin.app/)
- [`dshplugin-app/dsh-plugin-registry`](https://github.com/dshplugin-app/dsh-plugin-registry)
- [`dshplugin-app/deepseek-harness-plugins`](https://github.com/dshplugin-app/deepseek-harness-plugins)
- [`dsh-plugin.io`](https://dsh-plugin.io/)
