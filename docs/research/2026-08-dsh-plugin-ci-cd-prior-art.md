# DSH plugin CI/CD prior art

Date: 2026-08-29

Context: follow-up research for [#43 — Standard DSH plugin validation and publishing workflow](https://github.com/S2P2/dsh-lab/issues/43), especially [#44](https://github.com/S2P2/dsh-lab/issues/44) through [#48](https://github.com/S2P2/dsh-lab/issues/48).

## Executive recommendation

There is no single CI/CD convention used by popular DSH plugins. Some high-download plugins have sophisticated real-DSH integration tests and release pipelines, while others have no `.github/workflows` directory at all. The best path for `dsh-lab` is therefore to **combine a few proven patterns rather than copy one repository wholesale**.

Recommended composition:

1. **Keep the repository-owned validator from #44.** Use [`bowenliang123/dsh-plugin-checker`](https://github.com/bowenliang123/dsh-plugin-checker) as prior art for the cheap manifest → native install → `--dump-config` checks, but do not rely on it as the complete gate because it installs the source directory rather than the packed release artifact.
2. **Adapt `dsh-market`'s real-harness scaffold for the core release seam.** It creates a temporary `DSH_HOME`, runs `npm pack`, installs the resulting `.tgz` with real DSH, and then boots that composition. This is the closest existing prior art to #44's packed-artifact requirement.
3. **Adapt `dsh-browser`'s artifact-promotion release shape.** Build and pack once in an unprivileged job, upload the exact `.tgz`, then have publish/release jobs download and promote those exact bytes. Do not rebuild after validation.
4. **Use npm Trusted Publishing (OIDC) for #48.** `dsh-market`, `dsh-context`, `dsh-find-plugin`, and `dsh-history` all demonstrate tokenless/short-lived publication flows with `id-token: write`. Prefer this over a long-lived `NPM_TOKEN` when npm configuration permits it.
5. **Keep the required DSH baseline pinned.** `dsh-market` and `dsh-vision-toolkit` pin the DSH version used by required integration tests. Add a separate scheduled `@latest` compatibility canary later, following `dsh-Remote`, rather than making every PR depend on a moving upstream release.
6. **Use package-surface verification before installation.** `dsh-TUI` uses `npm pack --dry-run --json` to verify the published file surface. `dsh-lab` should go one step further and install the actual packed tarball.

The resulting `dsh-lab` release invariant should remain:

> The exact package artifact that will be promoted has passed structural checks, package-owned deterministic tests, native DSH installation in isolated state, config composition, and any bounded package-specific smoke test against the repository's pinned DSH baseline.

## Selection method

The community catalog was used only to select representative popular plugins. Workflow conclusions below come from each project's own repository.

The cached popularity data in [`awesome-dsh-plugin/data/downloads.json`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/downloads.json) was checked on 2026-08-19. It is a useful sampling aid, not a canonical ranking or quality score; the catalog itself explicitly says it does not rank plugins.

Representative cached download counts used for sampling:

| Repository | Cached downloads (2026-08-19) | Why inspected |
| --- | ---: | --- |
| `dsh-market/dsh-market` | 82,491 | Largest sampled plugin; rich CI + release pipeline |
| `Anionex/dsh-vision-toolkit` | 17,248 | Real DSH profile acceptance, Node/platform matrix |
| `ccch1mneyyy/dsh-TUI` | 16,959 | Large package verification and release workflow |
| `bowenliang123/dsh-context` | 6,612 | Uses reusable `dsh-plugin-checker` action + OIDC release |
| `awesome-dsh-plugin/dsh-find-plugin` | 5,892 | Minimal OIDC publication example |
| `chenproton/dsh-history` | 3,568 | OIDC release with dry-run mode |
| `Blank-not-black/dsh-Remote` | 2,939 | Scheduled compatibility test against DSH `latest` |
| `anweat/dsh-browser` | 2,430 | Pack-once / publish-exact-artifact workflow |

Two other relatively high-download examples, `Aik358/dsh-auto-memory` and `Airmetro/dsh-update-checker`, did not expose a `.github/workflows` directory through GitHub at research time. This is useful evidence that popularity does not imply a common CI baseline.

## Comparison

| Project | PR / main CI | Package-surface check | Real DSH check | DSH version policy | Release/publish | Pattern worth adapting |
| --- | --- | --- | --- | --- | --- | --- |
| `dsh-market` | Linux + Windows checks; unit/static; pnpm compatibility; web E2E | `prepack`/preflight; real packed artifact in E2E | **Yes: packed `.tgz` in temporary `DSH_HOME`, then real DSH web** | Pinned `0.1.0-rc.8` in required E2E | npm Trusted Publishing; `dev`/`beta`/`latest` channels | Strongest #44 prior art; pinned real harness; fail-loud integration |
| `dsh-vision-toolkit` | Linux Node 22.19 + 24; Windows Node 24 | `verify:portable`; committed build diff | **Yes: required Profile acceptance** | Pinned `0.1.0-rc.6` | No dedicated publish workflow found in inspected workflow directory | Node/platform compatibility matrix; required acceptance flag |
| `dsh-TUI` | Large grouped CI with one aggregate gate; observational flaky/platform lanes | **`npm pack --dry-run --json` package verification** | Many DSH-adapter/package contract tests; not the same generic packed-install seam | Peer ranges; project-specific | Tag publish; provenance; separate release-bundle assets | Pack-surface check; build-once artifact reuse; aggregate gate; observation lanes |
| `dsh-context` | Typecheck/vitest + built-bundle smoke | Bundle smoke | **Uses `dsh-plugin-checker@v1`** | Checker input defaults to latest unless overridden | npm Trusted Publishing OIDC | Reusable checker discovery; release repeats validation; tag/version guard |
| `dsh-find-plugin` | No separate CI workflow found | `npm run check --if-present` in publish | No explicit real-DSH gate found | N/A | Minimal npm Trusted Publishing OIDC | Smallest OIDC example |
| `dsh-history` | Release-oriented checks | `pnpm publish --dry-run` option | No explicit real-DSH gate found | N/A | OIDC, serialized release, dry-run | Manual dry-run mode; publication concurrency |
| `dsh-browser` | Release workflow does build/pack | **Actual `.tgz` uploaded as Actions artifact** | No DSH install in inspected release workflow | N/A | Publish job downloads exact `.tgz`; GitHub Release uses same `.tgz` | Strongest #48 artifact-promotion pattern |
| `dsh-Remote` | Push + weekly compatibility workflow | Published npm artifact is installed | **Yes: installs from npm, boots DSH, curls plugin route** | Intentionally `@latest` | Separate release tooling | Excellent future scheduled upstream-compatibility canary |

## Prior art in detail

### 1. `bowenliang123/dsh-plugin-checker`: useful baseline, incomplete release gate

Sources:

- [README](https://github.com/bowenliang123/dsh-plugin-checker/blob/main/README.md)
- [Composite action](https://github.com/bowenliang123/dsh-plugin-checker/blob/main/action.yml)
- [Action self-test workflow](https://github.com/bowenliang123/dsh-plugin-checker/blob/main/.github/workflows/ci.yml)
- [`v1` tag](https://github.com/bowenliang123/dsh-plugin-checker/tree/v1)
- Example consumer: [`bowenliang123/dsh-context` release workflow](https://github.com/bowenliang123/dsh-context/blob/main/.github/workflows/release.yml)
- Another indexed consumer: [`DioMao/dsh-easy-upgrade` release workflow](https://github.com/DioMao/dsh-easy-upgrade/blob/495f94a379980d966b8eeace742ed775dde9990b/.github/workflows/release.yml)

The action performs three checks in a cheap-to-expensive order:

1. `package.json` exists and is valid; package name and `dsh.bundle.patch` are present; referenced patch file exists.
2. Install the selected repository path with `dsh plugin --profile <profile> add <rootPath>`.
3. Run `dsh --profile <profile> --dump-config` and grep for the bundle layer marker `# == <package-name>`.

Its inputs include `rootPath`, profile, DSH version, pnpm version, and Node version, so it already supports monorepo subdirectories.

This is very close to the cheap half of #44, and the action self-tests a known-valid and known-broken fixture. At research time the `v1` tag resolved to commit `e19b9d2f33a0bd3b9636670e4d2525f3ef8ecfb7`.

However, it is **not sufficient as the `dsh-lab` release gate**:

- it installs the source directory, not a packed tarball;
- it checks the patch in the checkout but does not prove the patch/runtime files survive `files`/`.npmignore` packaging;
- its `dshVersion` and `pnpmVersion` defaults are `latest`, whereas required `dsh-lab` CI should be reproducible and pinned;
- it does not supply the package's build/test/smoke lifecycle;
- it does not establish a locally reusable isolated `DSH_HOME` contract for our validator.

**Recommendation:** reimplement/adapt these three assertions inside the repository-owned #44 validator rather than adding the action as a second, duplicative gate. If the external action is ever used directly, pass explicit versions and pin the action to a reviewed commit SHA rather than depending only on the movable `@v1` major tag.

### 2. `dsh-market`: strongest packed-artifact + real-harness prior art

Sources:

- [CI workflow](https://github.com/dsh-market/dsh-market/blob/main/.github/workflows/ci.yml)
- [Web E2E scaffold](https://github.com/dsh-market/dsh-market/blob/main/tests/web/scaffold.ts)
- [package.json](https://github.com/dsh-market/dsh-market/blob/main/package.json)
- [release workflow](https://github.com/dsh-market/dsh-market/blob/main/.github/workflows/release.yml)

The project separates ordinary checks from a real-harness E2E lane. The real lane installs a **pinned** `@deepseek-ai/dsh@0.1.0-rc.8`, and runs on both Ubuntu and Windows.

More importantly, its scaffold creates a temporary `DSH_HOME`, runs `npm pack`, finds the generated `.tgz`, and installs **that tarball** through `dsh plugin --profile web add`. It then starts real DSH against the same temporary home. This directly tests the failure mode #44 is designed to catch: code that works in the checkout but is broken once packaged.

The scaffold also distinguishes local optional integration from required CI integration. When `DSHM_E2E_REQUIRED=1`, absence of the DSH CLI is an error instead of silently skipping the suite and reporting green. That is a good pattern for any `dsh-lab` smoke hook that may otherwise skip when prerequisites are absent.

The release workflow uses npm Trusted Publishing, checks package version against the Git tag, and supports separate `dev`, prerelease (`beta`), and stable (`latest`) channels. The multi-channel policy is useful prior art but is not needed for the first `dsh-lab` release gate.

**Adapt for #44/#45:** temporary DSH home + pack exact candidate + native DSH install + composition/smoke + fail-loud required mode.

### 3. `dsh-browser`: strongest exact-artifact promotion model

Source: [publish workflow](https://github.com/anweat/dsh-browser/blob/master/.github/workflows/publish.yml)

The release workflow has a particularly clean trust boundary:

1. an unprivileged `pack` job installs dependencies, checks tag/version, builds, runs `pnpm pack`, prints tarball contents, and uploads the `.tgz` as an Actions artifact;
2. the `publish` job depends on `pack`, downloads that artifact, and publishes the `.tgz` directly;
3. the GitHub Release job downloads the same artifact and attaches the same bytes to the release.

This avoids a common release integrity problem: validating one build and then rebuilding a subtly different artifact in the privileged publication job.

The current workflow uses an npm token plus provenance. For `dsh-lab`, retain the **artifact promotion architecture** but use Trusted Publishing/OIDC when possible.

**Adapt for #47/#48:** one validated tarball becomes the object promoted to npm and, if desired, GitHub Release assets. The publication job should not reconstruct the package.

### 4. `dsh-context`: source tests + reusable checker + OIDC release

Sources:

- [PR checks](https://github.com/bowenliang123/dsh-context/blob/main/.github/workflows/pr-checks.yml)
- [release](https://github.com/bowenliang123/dsh-context/blob/main/.github/workflows/release.yml)

PRs run frozen dependency install, package tests, build, and a built-bundle smoke test. Release repeats build/lint/test/smoke, first invokes `dsh-plugin-checker@v1`, verifies the tag matches the package version, then publishes using npm Trusted Publishing with `id-token: write` and no long-lived npm token.

The important design point is not to copy its duplication literally. In `dsh-lab`, #44 establishes one repository validation entry point; PR and release workflows should call it rather than spelling the release gate twice.

**Adapt for #46/#48:** tag/version mismatch should fail; use OIDC Trusted Publishing; keep release checks at least as strong as PR checks.

### 5. `dsh-vision-toolkit`: explicit compatibility matrix and required Profile acceptance

Source: [CI workflow](https://github.com/Anionex/dsh-vision-toolkit/blob/main/.github/workflows/ci.yml)

The project exercises Node 22.19 and Node 24 on Linux and Node 24 on Windows. It installs a pinned DSH CLI (`0.1.0-rc.6`) and marks its Profile acceptance tests as required with `DSH_VISION_REQUIRE_PROFILE_E2E=1`.

It also verifies its portable package surface and checks that committed build artifacts stay in sync.

**Adapt selectively:** the DSH/Node compatibility matrix is useful, but `dsh-lab` should not multiply required platform jobs before there is evidence they are needed. Start with the repository's supported primary environment, then add Windows/macOS lanes where package behavior crosses OS boundaries. The required-acceptance flag is worth copying conceptually so CI cannot turn an unavailable harness into a false green.

### 6. `dsh-TUI`: package-surface verification and CI orchestration

Sources:

- [CI workflow](https://github.com/ccch1mneyyy/dsh-TUI/blob/main/.github/workflows/ci.yml)
- [package scripts](https://github.com/ccch1mneyyy/dsh-TUI/blob/main/package.json)
- [publish workflow](https://github.com/ccch1mneyyy/dsh-TUI/blob/main/.github/workflows/publish.yml)
- [release bundle workflow](https://github.com/ccch1mneyyy/dsh-TUI/blob/main/.github/workflows/release-bundle.yml)

A useful package check is:

`npm pack --dry-run --json --ignore-scripts | node scripts/verify-package.mjs`

That explicitly validates the published file surface rather than assuming the checkout equals the package.

The large CI also compiles once, uploads the compiled output, and lets downstream test groups reuse that exact build. It has an aggregate required gate, while known timing-flaky checks and cross-platform smoke tests can run in observational lanes without silently weakening the required path.

For release assets it produces checksums and carefully routes workflow-dispatch input through environment variables before shell use, avoiding direct expression interpolation into shell commands.

**Adapt selectively:** use `pack --dry-run`/tarball inspection and artifact reuse. Do not import the TUI's complex test partitioning until `dsh-lab` has enough tests to justify it.

### 7. `dsh-history` and `dsh-find-plugin`: simple npm Trusted Publishing

Sources:

- [`dsh-history` release](https://github.com/chenproton/dsh-history/blob/main/.github/workflows/release.yml)
- [`dsh-find-plugin` publish](https://github.com/awesome-dsh-plugin/dsh-find-plugin/blob/main/.github/workflows/publish.yml)

Both demonstrate small Trusted Publishing workflows. `dsh-history` is more useful for `dsh-lab` because it also serializes publication and offers a manually triggered dry-run path. `dsh-find-plugin` is a minimal example of `contents: read` + `id-token: write` + modern npm + `npm publish` without `NODE_AUTH_TOKEN`.

**Adapt for #48:** minimal permissions, OIDC, serialized publication, and an explicit dry-run mode are all sensible defaults.

### 8. `dsh-Remote`: a separate `latest` compatibility canary

Source: [compatibility workflow](https://github.com/Blank-not-black/dsh-Remote/blob/main/.github/workflows/compat.yml)

Unlike the required/pinned patterns above, this workflow intentionally installs `@deepseek-ai/dsh@latest`. It runs on main, manually, and weekly. It creates a temporary `DSH_HOME`, installs the **already-published npm package**, confirms the plugin is listed, starts real DSH web, and curls a plugin-owned route.

This answers a different question from #44:

- **Pinned required gate:** “does this candidate work with the compatibility baseline we claim?”
- **Scheduled latest canary:** “did a newer DSH release break our already-published plugin?”

Those should remain separate. A moving `latest` dependency should not randomly block unrelated pull requests.

**Future recommendation:** after #46 is stable, add a scheduled non-release canary that tests public `dsh-lab` plugins against `@deepseek-ai/dsh@latest` and reports upstream drift. It can become required for a deliberate compatibility bump, but not for every ordinary PR.

## What to reuse for each `dsh-lab` ticket

### #44 — local packed-artifact DSH release gate

Reuse/adapt:

- `dsh-plugin-checker`: manifest/name/`dsh.bundle.patch`/patch-exists assertions; install + bundle-layer check.
- `dsh-market`: temporary `DSH_HOME`; `npm pack`/tarball installation through native DSH; real composition.
- `dsh-TUI`: package-surface inspection before install.

Keep our stronger decisions:

- validate the actual `.tgz`, not the repository directory;
- pin DSH baseline;
- make local and CI execution share one implementation;
- do not require a marketplace action to be reachable.

### #45 — smoke hooks and validator regression fixtures

Reuse/adapt:

- `dsh-plugin-checker`: valid fixture plus expected-failure fixture.
- `dsh-market` / `dsh-vision-toolkit`: an explicit “required integration” signal so the CI environment cannot silently skip a smoke check.

Add cases the external checker does not cover:

- patch/runtime file exists in source but is absent from `.tgz`;
- exact tarball identity;
- isolated DSH home;
- package-specific post-install smoke hook.

### #46 — mandatory PR CI

Reuse/adapt:

- read-only permissions and frozen dependency install from the mature projects;
- `dsh-market` pinned real-harness lane;
- `dsh-vision-toolkit` Node/platform matrix only where justified;
- `dsh-TUI` aggregate required gate if the monorepo eventually has enough parallel jobs to need one.

Do not use DSH `latest` in the required lane.

### #47 — Changesets release gate

Reuse/adapt:

- release must call the same validator as PR/local execution;
- tag/package version mismatch should fail before publication;
- validation should create one candidate artifact that later jobs can promote.

The exact version/tag choreography remains owned by Changesets in `dsh-lab`; do not replace it with another release manager just because a single-package prior-art repo uses raw `v*` tag pushes.

### #48 — opt-in npm publication

Best combined pattern:

1. unprivileged job creates and validates the exact `.tgz`;
2. upload `.tgz` as an Actions artifact;
3. trusted publish job downloads the exact artifact;
4. publish via npm Trusted Publishing/OIDC;
5. serialize publication so package/dist-tag state cannot race;
6. optionally attach the same `.tgz` to a GitHub Release.

This combines `dsh-browser`'s exact-artifact promotion with `dsh-market`/`dsh-context`/`dsh-history` Trusted Publishing.

## Patterns not to copy blindly

- **`latest` in required CI.** Useful for scheduled compatibility monitoring, not a reproducible merge gate.
- **Source-directory install as the only DSH acceptance check.** It misses broken package file lists and build outputs.
- **Long-lived `NPM_TOKEN` when Trusted Publishing is available.** Several DSH plugins already demonstrate OIDC-based publication.
- **Rebuilding in the publish job.** Prefer promoting the exact tarball that passed validation.
- **Large platform/test matrices before evidence justifies them.** `dsh-TUI` and `dsh-market` need that complexity because their runtime surfaces are broad; the shared `dsh-lab` gate should begin narrow.
- **Workflow-only validation logic.** #44 intentionally requires a local reusable command, so shell logic embedded only in GitHub Actions would make CI behavior hard to reproduce.
- **External action version tags as the sole trust boundary.** If an external action is used in a privileged release workflow, pin a reviewed commit SHA or otherwise deliberately manage action provenance.

## Proposed target flow after applying the prior art

```text
PR / local
  │
  ├─ package build/test (when present)
  ├─ cheap bundle manifest checks
  ├─ pack candidate .tgz
  ├─ inspect packed surface
  ├─ temporary DSH_HOME
  ├─ install exact .tgz with pinned DSH
  ├─ dsh --dump-config bundle-layer assertion
  └─ optional package smoke
        │
        ▼
validated .tgz
        │
        ├─ Changesets version/release gate
        │
        └─ upload immutable CI artifact
                 │
                 ▼
          trusted publish job
          (OIDC, no rebuild)
                 │
        ┌────────┴────────┐
        ▼                 ▼
       npm          GitHub Release

separate scheduled lane:
published plugin + DSH @latest → install/load/smoke compatibility canary
```

## Bottom line

The research strengthens rather than changes the design in #43–#48. Existing DSH projects already validate nearly every individual idea we chose, but no single project combines all of them:

- `dsh-plugin-checker` proves the cheap DSH-specific assertions are reusable;
- `dsh-market` proves packed-artifact + isolated real-DSH testing is practical;
- `dsh-browser` proves exact build artifacts can be promoted without rebuilding;
- several projects prove npm OIDC Trusted Publishing is already viable in the DSH ecosystem;
- `dsh-Remote` shows how to monitor a moving DSH `latest` without making it the required release baseline.

Therefore #44 should remain the frontier, but its implementation should explicitly study and adapt `dsh-market`'s pack/install scaffold and `dsh-plugin-checker`'s layer assertion before writing new validation logic.