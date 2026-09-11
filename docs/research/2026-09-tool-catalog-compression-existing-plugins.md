# Existing DSH tool-catalog compression plugins

**Researched:** 2026-09-12  
**Question:** Is there already a DeepSeek Harness plugin similar to issue #77 (`dsh-tool-catalog-lean`), especially one that reduces the model-facing cost of existing tool schemas without changing runtime execution?

## Conclusion

No exact substitute was found for issue #77's proposed **stock-tool, descriptions-only, curated rewrite**. However, there is one very close implementation that validates the same extension seam and could be reused as prior art: **`Stijnus/dsh-mcp-overview`** already rewrites model-facing tool schemas in `system-prompt/assemble`, shortening descriptions and recursively trimming documentation-only JSON-Schema fields. Its scope is only `mcp__*` tools and its transformation is generic/aggressive rather than a curated stock-tool description map.

Several tool-search plugins attack the same context-cost problem more aggressively through **progressive disclosure**. They are alternatives if the desired behavior changes from “keep all Standard tools visible, but shorten their prose” to “keep a small eager core and load other tools on demand.”

## Closest match: `Stijnus/dsh-mcp-overview`

Repository: https://github.com/Stijnus/dsh-mcp-overview

The plugin has a `toolCompression` feature with `brief`, `names`, and `none` modes. `brief` keeps the first sentence of descriptions and removes documentation-only schema keys; `names` removes descriptions more aggressively. The README explicitly states that this happens through the `system-prompt/assemble` pipeline. Source: https://github.com/Stijnus/dsh-mcp-overview/blob/main/README.md

The implementation in `src/trim.ts` is particularly relevant to #77. It:

- operates on the assembled `ToolSchema[]`, not registered runtime definitions;
- limits itself to `mcp__*` tools;
- shortens top-level and nested `description` fields;
- recursively drops `examples`, `default`, `title`, `$comment`, `deprecated`, `readOnly`, `writeOnly`, and `x-*` extension fields;
- explicitly preserves names, parameter names, types, `required`, `enum`, and structural keywords.

Source: https://github.com/Stijnus/dsh-mcp-overview/blob/main/src/trim.ts

### Relationship to #77

This is the strongest existing prior art. Both use the same authoritative presentation-time seam and both leave runtime registration/execution alone. The differences are important:

| Dimension | `dsh-mcp-overview` | issue #77 proposal |
| --- | --- | --- |
| Target | MCP tools only (`mcp__*`) | Stock Standard tools |
| Selection | Namespace-based | Curated map keyed by stock tool name |
| Description strategy | First sentence or empty | Hand-curated semantically faithful replacement |
| Schema structure | Also removes documentation-only fields | Descriptions only; all non-description structure invariant |
| Goal | MCP overview plus optional compression | Dedicated reusable lean catalog mechanism |

Because #77 deliberately requires a descriptions-only invariant, directly adopting `trimMcpSchemas()` would not satisfy the spec. The useful reuse is the **hook shape, cloning assumptions, traversal pattern, and tests/concepts**, not its exact transformation policy.

## Alternative family: tool-search / progressive disclosure

### `Letter2025/dsh-tool-search`

Repository: https://github.com/Letter2025/dsh-tool-search

This plugin calls itself “tool search & slimming” and uses `system-prompt/assemble` to replace deferred tool schemas with three bridge tools: `tool_search`, `tool_describe`, and `tool_call`. Core tools remain eager; long-tail tools are dynamically warmed into the visible set after discovery. Source: https://github.com/Letter2025/dsh-tool-search/blob/main/README.md

This can reduce context much more than #77, but it changes the model interaction contract: not every tool remains directly visible at the start of every turn. It also introduces grouping, ranking/reranking, warm-tool state, and bridge calls. It is therefore an architectural alternative, not a drop-in substitute for #77.

### `vibeinging/dsh-tool-search`

Repository: https://github.com/vibeinging/dsh-tool-search

This experimental implementation exposes one scope-local `tool_search` plus configured `alwaysVisible` tools, and uses `ctx.tools.restrict()` so other tools become visible only after selection. Its README explicitly describes the fixed schema cost, deferred schema savings, selection persistence, and KV-cache trade-offs. Source: https://github.com/vibeinging/dsh-tool-search/blob/main/README.md

Again, this solves catalog size by hiding/defering tools, whereas #77 intentionally keeps the complete Standard tool surface immediately callable and only trims prose.

## MCP-specific progressive disclosure: MCP Lens

Repository: https://github.com/labmimors/dsh-mcp-lens  
Upstream discussion: https://github.com/deepseek-ai/deepseek-harness/discussions/2137

MCP Lens puts large MCP catalogs behind two model-facing interfaces (`mcp_search` and `mcp_call`) and reveals exact schemas only for ranked candidates. It reports large reductions for very large MCP catalogs. This is strong evidence that catalog cost is a real DSH ecosystem concern, but its scope and interaction model are different from #77.

## Upstream seam confirmation

DSH's system-prompt documentation defines `system-prompt/assemble` as an expert waterfall over assembled sections, contexts, tools, and variables, with the returned assembly authoritative. That makes presentation-time tool rewriting an intended extension point rather than a registry hack. Source: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md

The tools documentation also distinguishes the registered `ToolDefinition` from the model-facing `ToolSchema` and notes that normal tool-schema cost is fixed per request while visible. Source: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md

## Recommendation for issue #77

Keep #77, but update its prior-art section to name **`Stijnus/dsh-mcp-overview` as the closest implementation**. It demonstrates almost exactly the mechanism #77 proposes, just for a different target and with a broader transformation policy.

Do **not** replace #77 with one of the tool-search plugins unless the desired UX changes. For a lean profile derived from Standard where the goal is “all familiar tools remain directly visible and callable, just with cheaper descriptions,” the curated descriptions-only plugin remains a distinct capability.

A reasonable implementation path is to borrow the traversal/hook pattern from `dsh-mcp-overview`, narrow the invariant to `description` fields only, and maintain the curated stock-tool replacement map proposed in #77.
