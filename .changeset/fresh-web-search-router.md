---
'@s2p2/dsh-web-search-router': minor
---

Fresh package `@s2p2/dsh-web-search-router` (tracer-bullet scope of spec #8): one stock `web_search` provider walking internal search adapters sequentially with a closed failure vocabulary, result validity (≥1 usable HTTP(S) source, conservative dedup, `maxResults`), per-attempt deadlines with terminal caller-abort handling, sanitized chain-exhaustion errors, and the keyless DuckDuckGo hop. Failure/retry budget, health, keyed hops, SearXNG/Codex/z.ai, settings host and card follow in the same PR as their tickets land.
