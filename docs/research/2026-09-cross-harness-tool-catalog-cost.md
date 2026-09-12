# Cross-harness approaches to model-facing tool catalog cost

**Researched:** 2026-09-12  
**Question:** How do other coding-agent harnesses control the fixed context cost of tool schemas, and what does that imply for `dsh-tool-catalog-lean` / issue #77?

## Scope and source pins

Primary-source code was inspected in:

- **Pi:** `earendil-works/pi` @ `71dca871bc80b6bc97be37f0ca3189399d651fff`
- **OpenAI Codex:** `openai/codex` @ `39d193d72d7959d798642bd3e1496bb8865033b1`
- **Prime Agent:** `PrimeIntellect-ai/prime-agent` @ `b53c2e9d0666d62ac72b94b754fd649f1f9ff366`
- **oh-my-pi:** `can1357/oh-my-pi` @ `73b993d7d5966bf9681e379ee5bfad64aa01825d`

This research focuses on model-facing tool definitions and discovery/presentation, not output compaction.

## Executive result

No inspected harness implements exactly the #77 policy: **keep the whole normal tool set directly visible while replacing only description strings with a curated shorter map**.

The harnesses instead cluster into three strategies:

1. **Small eager native surface** — Pi and especially Prime Agent reduce the number of direct schemas in the first place.
2. **Progressive disclosure / deferred loading** — Codex and oh-my-pi expose a small direct surface and make other tools discoverable on demand.
3. **Separate concise prompt hints from tool schemas** — Pi keeps one-line `promptSnippet`s for the system prompt while the actual tool schema retains richer descriptions.

This makes #77 a valid intermediate design for DSH: less disruptive than progressive disclosure, but more context-efficient than shipping stock descriptions unchanged.

---

## Pi (`earendil-works/pi`)

### Small default tool set

Pi's system-prompt builder documents the default selected tools as `[read, bash, edit, write]` and constructs its human-readable “Available tools” list from optional one-line snippets rather than copying full tool descriptions into the system prompt.

Source: `packages/coding-agent/src/core/system-prompt.ts`
https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/system-prompt.ts

The same file explicitly says a tool appears in the `Available tools` section only when the caller supplies a one-line snippet.

### Tool schema descriptions remain richer

Pi does **not** appear to compress its actual tool schemas at request assembly time. Built-in definitions carry normal descriptions and per-property descriptions.

For example, `read` has three compact property descriptions (`path`, `offset`, `limit`), while the tool-level description still explains supported images, output limits, truncation, and continuation via offsets. It separately declares:

- snippet: `Read file contents`
- guideline: `Use read to examine files instead of cat or sed.`

Source: `packages/coding-agent/src/core/tools/read.ts`
https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/read.ts

Similarly, `bash` has only `command` and optional `timeout` in its schema, a one-line system-prompt snippet (`Execute bash commands (ls, grep, find, etc.)`), and a richer model-facing tool description covering working directory, stdout/stderr, truncation, spill-to-file, and timeout semantics.

Source: `packages/coding-agent/src/core/tools/bash.ts`
https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/bash.ts

### Design lesson for DSH

Pi saves context primarily through **surface-area restraint and shallow schemas**, not a generic description-rewriting pass. It also distinguishes two jobs that DSH Standard currently tends to combine inside tool descriptions:

- short capability reminder in the system prompt (`promptSnippet`),
- actual invocation contract in the tool schema.

For #77, Pi supports the idea that stock tool descriptions do not need to be prose-heavy, but it does **not** provide a reusable compression mechanism to copy.

---

## Prime Agent (`PrimeIntellect-ai/prime-agent`)

### More radical surface reduction

Prime Agent is built on Pi-family infrastructure (`@earendil-works/pi-agent-core`) but makes a much stronger architectural move: the normal coding surface centers on only **`ipython`, `bash`, and `edit`**. Its own plan-mode example calls that set `NORMAL_MODE_TOOLS`, and regression coverage verifies the same three legacy names.

Sources:

- `packages/coding-agent/examples/extensions/plan-mode/index.ts`
- `packages/coding-agent/test/suite/regressions/4428-remove-legacy-pi-mono-tools.test.ts`

https://github.com/PrimeIntellect-ai/prime-agent/blob/b53c2e9d0666d62ac72b94b754fd649f1f9ff366/packages/coding-agent/examples/extensions/plan-mode/index.ts

### Capabilities move behind persistent Python

The system-prompt builder explicitly says tool schemas carry tool descriptions **outside** the prompt body. For the default RLM prompt it only treats `ipython`, `bash`, and `edit` as the active native-tool subset.

It also instructs the model to access configured MCP servers through a pre-imported Python `mcp` object, using `await mcp.list_tools(server)` then `await mcp.call_tool(...)`, rather than exposing every MCP function as a top-level native schema.

Source: `packages/coding-agent/src/core/system-prompt.ts`
https://github.com/PrimeIntellect-ai/prime-agent/blob/b53c2e9d0666d62ac72b94b754fd649f1f9ff366/packages/coding-agent/src/core/system-prompt.ts

The `ipython` tool itself is a persistent REPL and bootstraps additional runtime capabilities such as `rlm`, `bash`, and `rlm.mcp`. Its schema is just one `code` string, although that property's description and the tool-level description are reasonably detailed.

Source: `packages/coding-agent/src/core/tools/ipython.ts`
https://github.com/PrimeIntellect-ai/prime-agent/blob/b53c2e9d0666d62ac72b94b754fd649f1f9ff366/packages/coding-agent/src/core/tools/ipython.ts

### Design lesson for DSH

Prime Agent avoids the 20+ native-schema problem rather than optimizing it. The trade-off is architectural: capabilities become APIs inside a persistent code execution environment rather than direct model tools.

This resembles DSH PTC/Code Mode more than the intended `standard-lean` UX. It is useful evidence that **very small native surfaces are viable**, but it is not a substitute if the goal is to preserve Standard's familiar direct tools.

---

## OpenAI Codex (`openai/codex`)

### Direct core tools use fairly concise schemas

Codex's unified shell tool (`exec_command`) uses short field descriptions such as `Shell command to execute.` and `Working directory for the command. Defaults to the turn cwd.`. The top-level description is also compact: it says the command runs in a PTY and returns output or a session ID for ongoing interaction.

Source: `codex-rs/core/src/tools/handlers/shell_spec.rs`
https://github.com/openai/codex/blob/39d193d72d7959d798642bd3e1496bb8865033b1/codex-rs/core/src/tools/handlers/shell_spec.rs

This is closer to #77's desired writing style than current DSH Standard: most operational detail is encoded tersely in individual fields instead of a long narrative tool description.

### Codex now has first-class deferred tool search

Codex contains a core `tool_search` implementation for tools whose registry exposure is deferred. The handler builds a BM25 index over deferred tool metadata; search results return `LoadableToolSpec`s.

Source: `codex-rs/core/src/tools/handlers/tool_search.rs`
https://github.com/openai/codex/blob/39d193d72d7959d798642bd3e1496bb8865033b1/codex-rs/core/src/tools/handlers/tool_search.rs

The model-facing `tool_search` spec says it “searches over deferred tool metadata” and “exposes matching tools for the next model call.” Its schema only has `query` and optional `limit`. The description can advertise available tool sources, and source descriptions are explicitly byte-bounded.

Source: `codex-rs/core/src/tools/handlers/tool_search_spec.rs`
https://github.com/openai/codex/blob/39d193d72d7959d798642bd3e1496bb8865033b1/codex-rs/core/src/tools/handlers/tool_search_spec.rs

The tool-planning code applies exposure policy to MCP tools, and configuration includes a `direct_only_tool_namespaces` concept for namespaces that bypass deferral.

Sources:

- `codex-rs/core/src/tools/spec_plan.rs`
- `codex-rs/core/config.schema.json`

https://github.com/openai/codex/blob/39d193d72d7959d798642bd3e1496bb8865033b1/codex-rs/core/src/tools/spec_plan.rs

### Design lesson for DSH

Codex uses a **hybrid** strategy:

- concise direct schemas for frequently needed core operations,
- deferred discovery for larger/optional tool families.

This is probably the strongest long-term reference architecture for DSH. #77 corresponds to improving the first half (make eager stock schemas cheaper); DSH ToolSearch/MCP-Lens-style work corresponds to the second half.

These approaches are complementary rather than competing.

---

## oh-my-pi (`can1357/oh-my-pi`)

oh-my-pi has the most explicit tool-presentation architecture of the systems inspected.

### `essential` vs `discoverable` is a first-class property

The core agent type defines:

```ts
export type ToolLoadMode = "essential" | "discoverable";
```

and clarifies that enablement and presentation are separate: a tool can be enabled while its `loadMode` determines how it is presented.

Source: `packages/agent/src/types.ts`
https://github.com/can1357/oh-my-pi/blob/73b993d7d5966bf9681e379ee5bfad64aa01825d/packages/agent/src/types.ts

Custom and extension tools default to `discoverable`; authors can opt into `essential` to keep them top-level.

Source: `packages/coding-agent/src/extensibility/custom-tools/types.ts`
https://github.com/can1357/oh-my-pi/blob/73b993d7d5966bf9681e379ee5bfad64aa01825d/packages/coding-agent/src/extensibility/custom-tools/types.ts

The canonical essential built-in list includes direct coding primitives such as `read`, `write`, `bash`, `edit`, and `glob`, along with several harness-specific control tools.

Source: `packages/coding-agent/src/tools/essential-tools.ts`
https://github.com/can1357/oh-my-pi/blob/73b993d7d5966bf9681e379ee5bfad64aa01825d/packages/coding-agent/src/tools/essential-tools.ts

### Discoverable tools can disappear from the native tool array entirely

The `xd://` layer is explicitly designed to unmount discoverable built-ins and custom tools from the request's normal tools array. The existing `read`/`write` tools become the transport:

```text
read  xd://          -> list mounted tools
read  xd://<tool>    -> docs + JSON schema
write xd://<tool>    -> execute with JSON args
```

Source: `packages/coding-agent/src/tools/xdev.ts`
https://github.com/can1357/oh-my-pi/blob/73b993d7d5966bf9681e379ee5bfad64aa01825d/packages/coding-agent/src/tools/xdev.ts

The same source explicitly frames the benefit as avoiding duplicated wire schemas, while acknowledging that inlining every mounted tool's docs can still be expensive. It therefore supports catalog/on-demand documentation modes and applies budgets/caps, including:

- total mounted-doc budget: 48,000 characters,
- per-device cap: 10,000 characters,
- external description cap: 200 characters before pointing the model to `read xd://<tool>` for full docs.

This is extremely close in spirit to the broader catalog-cost problem behind #77, but it solves it by changing the interaction protocol rather than shortening direct native schemas.

### oh-my-pi measures prompt cost explicitly

The repo includes `scripts/tool-prompt-usage.ts`, which renders every tool prompt template and reports tokens, characters, and lines using selectable `o200k_base` or `cl100k_base` tokenizers.

Source: `scripts/tool-prompt-usage.ts`
https://github.com/can1357/oh-my-pi/blob/73b993d7d5966bf9681e379ee5bfad64aa01825d/scripts/tool-prompt-usage.ts

That script is useful prior art for #77's diagnostics/tests: DSH currently measures serialized characters, but oh-my-pi demonstrates maintaining a dedicated prompt-cost audit tool as part of the repository.

### Tool docs can be long even when schemas are hidden

For example, oh-my-pi's `bash` model guidance is a dedicated Markdown template containing usage policy, tool-routing rules, async behavior, and output semantics.

Source: `packages/coding-agent/src/prompts/tools/bash.md`
https://github.com/can1357/oh-my-pi/blob/73b993d7d5966bf9681e379ee5bfad64aa01825d/packages/coding-agent/src/prompts/tools/bash.md

This demonstrates an important distinction: **schema compression and total prompt compression are separate problems**. Moving prose out of schemas does not save context if the same prose is always re-injected elsewhere.

### Design lesson for DSH

oh-my-pi provides the most mature reference for a future DSH “essential vs discoverable” layer. Its design also reinforces #77's decision **not** to relocate descriptions into supplementary system-prompt sections: doing so would merely move the cost.

---

## Comparison

| Harness | Main catalog-cost strategy | Core schemas directly visible? | Optional/long-tail strategy | Relation to #77 |
| --- | --- | --- | --- | --- |
| Pi | Small fixed tool surface + shallow schemas + one-line prompt snippets | Yes | Custom tools remain normal tools | Supports concise authoring; no compression layer |
| Prime Agent | Very small native surface (`ipython`, `bash`, `edit`) | Yes, very few | Capabilities accessed through persistent Python/skills/MCP API | Alternative architecture closer to Code/PTC mode |
| Codex | Concise core tools + native deferred tool search | Yes for core | BM25 `tool_search`, load matching specs next call | Best hybrid long-term reference |
| oh-my-pi | Essential/direct vs discoverable + `xd://` virtual devices | Essential only | Discover/read docs/call through `read`+`write` transport | Strongest progressive-disclosure reference |
| DSH #77 | Keep current eager stock set but curate description strings | Yes, unchanged | Out of scope | Lowest-behavior-change optimization |

## Implications for issue #77

### 1. Keep #77's scope

The cross-harness evidence does **not** make #77 redundant. None of these systems provides the same low-risk transition:

> same DSH Standard tools, same schemas and calls, less descriptive prose.

That remains useful specifically because `standard-lean` is intended to feel like Standard rather than PTC, Prime Agent, or a discovery-first harness.

### 2. Treat #77 as the eager-core optimization, not the final catalog architecture

Codex and oh-my-pi suggest a layered future:

```text
Tier 1: essential/eager tools
  -> concise, high-quality schemas (#77-style optimization)

Tier 2: optional/plugin/MCP tools
  -> deferred discovery / tool search / virtual dispatch
```

The current #77 plugin is therefore compatible with later ToolSearch work rather than a competing direction.

### 3. Consider an upstream stock-description cleanup after dogfooding

Pi and Codex both demonstrate that frequently used core tools can carry materially shorter descriptions at the source. If #77's curated descriptions prove reliable, the long-term best outcome may be upstreaming some of those shorter descriptions into DSH's stock tool packages, reducing the need for an interception plugin for the core set.

### 4. Add a prompt-cost audit, but keep the invariant stronger than oh-my-pi

The oh-my-pi `tool-prompt-usage.ts` script is good prior art for a repeatable size report. #77 should retain its stronger safety invariant — strip descriptions from original/transformed schemas and assert deep equality — while optionally adding token estimates later.

### 5. Do not move description prose into the system prompt merely to shrink schemas

oh-my-pi's large dedicated tool prompt templates show why: schema bytes disappear, but total model context may not. #77's current choice to genuinely shorten prose rather than relocate it is sound.

## Recommendation

For `standard-lean`, proceed with #77 as specified, with two framing updates:

1. Describe it as **eager-core catalog optimization** in a broader two-tier architecture.
2. Add Codex and oh-my-pi as long-term progressive-disclosure references, while Pi and Prime Agent are evidence for aggressively minimizing the eager native surface.

The strongest combined direction is:

```text
standard-lean v1
  Standard-like direct tool UX
  + curated concise descriptions (#77)

possible later evolution
  concise essential direct tools
  + deferred plugin/MCP/rare tools
  + explicit catalog-cost audit
```

That preserves current usability now without blocking the architecture other mature harnesses are converging toward.
