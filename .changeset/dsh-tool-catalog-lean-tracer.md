---
'@s2p2/dsh-tool-catalog-lean': minor
---

Add `@s2p2/dsh-tool-catalog-lean` (tracer bullet for spec #77, ticket #79): a host-side plugin that registers a `system-prompt/assemble` waterfall listener and replaces the stock `bash` tool description (tool-level plus parameter-level) with a curated, semantically faithful short form. The projection is a pure, deterministic, descriptions-only transform — the captured 23-tool stock catalog shrinks from 21,062 to 19,790 compact-serialized chars (bash: 3,242 → 1,970) while every non-bash tool is delivered byte-identical, verified against the committed fixture with safety-invariant, pass-through, determinism, checklist, and waterfall integration tests. Full curated map (#80) and config (#81) follow.
