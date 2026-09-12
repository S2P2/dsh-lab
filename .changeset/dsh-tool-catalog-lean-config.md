---
'@s2p2/dsh-tool-catalog-lean': minor
---

Add the preset-author config surface (#81 of spec #77), delivered through the plugin row's `config:` key: `enabled` (default true; explicit false registers no listener so the assembled catalog stays byte-identical to stock for A/B comparison), `overrides` (per-tool description entries merging over the curated map — whole-entry replacement per tool name, replacing curated entries or adding new tool names, with the descriptions-only safety invariant preserved), and `diagnostics` (default false; one host-logger line per assembly, e.g. `tool-catalog-lean: 23 tools, 21062 -> 19790 chars`). Config is consumed defensively in `apply(ctx, config)` with in-code defaults — no schema dependency; the curated+override map merges once, deterministically, at apply time.
