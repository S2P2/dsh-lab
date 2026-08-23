---
'@s2p2/dsh-web-search-router': minor
---

Initial `dsh-web-search-router`: model-conditional `web_search` routing (Codex models → Codex search, GLM → z.ai search) with a keyed Exa → Tavily → free DDG/SearXNG fallback chain, per-search model detection via the agent initiator and session request header (ADR 0002), failure rotation with 429 `Retry-After` cooldowns, provenance notes, and a shared (never duplicated) dsh-codex OAuth document for the Codex hop.
