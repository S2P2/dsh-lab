# Changesets

One Markdown file per PR that changes a package under `packages/` — `pnpm changeset` generates it. Bump rules for these 0.x packages: **minor** for anything new or breaking-allowed, **patch** for fixes and tweaks.

Merging to `main` updates the "Version Packages" PR; merging that bumps versions, writes `CHANGELOG.md` files, and tags. Private packages (`dsh-quota-bar`) get versioned, never published.
