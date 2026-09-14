# @s2p2/dsh-web-search-router

One stock `web_search` tool for DeepSeek Harness (DSH) over an ordered fallback chain of search backends: **Exa → Tavily → Codex → z.ai → SearXNG → DuckDuckGo** (default order; reorder and enable/disable in the plugin's Settings card). The router tries backends sequentially, stops at the first result with at least one usable HTTP(S) source, and keeps a keyless DuckDuckGo tail so search survives paid-backend quota exhaustion. Spec of record: [S2P2/dsh-lab#8](https://github.com/S2P2/dsh-lab/issues/8).

## Install (dogfood, from a checkout)

```sh
dsh plugin --profile web add ../dsh-lab/packages/dsh-web-search-router
```

The bundle patch inserts the plugin into the profile. Provider selection is id-based, not registration-order based — pin the route in the profile's `cordis.patch.yml` (the patch layer applies after bundle layers):

```yaml
- id: web
  config:
    searchProvider: web-search-router
```

> **Important:** while this router owns the search route, `dsh-codex-connect`'s `enableSearch` option must stay `false`. If switched on, that plugin takes over the profile's entire search route at runtime and this router silently stops serving `web_search`. The Router's Codex backend instead wraps `dsh-codex-connect`'s exported credential store and search provider as a library, and the exact tested version of that package is pinned as an (optional) peer dependency.

## Status

Complete v1 surface (spec #8): router core, failure policy (one-retry transients + 15 s deadline budget), passive health/cooldowns, bounded content-free diagnostics, keyed REST hops (Exa + Tavily via `EXA_API_KEY`/`TAVILY_API_KEY`), Codex (wrapping `dsh-codex-connect` exports as a library), z.ai (MCP wire, `ZAI_API_KEY`), SearXNG (one configured self-hosted instance), DuckDuckGo (keyless), the plugin-owned `web-search-router` settings namespace (ordered chain, global knobs, SearXNG URL), and the browser Settings card (ordering, four-state status, diagnostics). Entirely hermetic test suite; live-network verification happens in the dogfood cutover.

## Backends

| Backend | Auth | Notes |
|---|---|---|
| Exa | `EXA_API_KEY` | keyed REST; `Retry-After` honored |
| Tavily | `TAVILY_API_KEY` | keyed REST; `answer` → result content |
| Codex | ChatGPT OAuth (via `dsh-codex-connect` store) | wrapped library; exact-version peer pin |
| z.ai | `ZAI_API_KEY` | MCP `web_search_prime`; bounded session repair |
| SearXNG | none (self-hosted) | exactly one configured base URL; Needs setup without it |
| DuckDuckGo | none | keyless HTML hop; anti-bot detection |

Credentials resolve through the DSH credential seam per operation (it already layers env/store/`.env`); this package never adds its own `process.env` fallback and never sees or stores secret values beyond passing them to the upstream request.

## Design notes

- One `WebSearchProvider` registered on `ctx.web` (id `web-search-router`). The router never receives or calls the seam itself — no provider-to-provider recursion.
- Internal adapters throw failures from a closed vocabulary (`config`, `auth`, `quota`, `rate_limit`, `timeout`, `network`, `upstream`, `malformed`, `empty`); the router owns order, deadlines, retries, and health.
- Failure policy: one retry per backend, only for clearly transient failures (adapter-marked transport and 502/503/504 equivalents); auth/quota/rate-limit/malformed/empty/config/timeout failures are never retried — timeout falls back immediately. A 15 s overall budget covers attempts, retries, and retry delays; each attempt is capped at 5 s and clamped to the remaining budget; no work starts after the budget is exhausted; a structured `Retry-After` is honored as the retry delay but never allowed to exceed the deadline.
- Caller cancellation is terminal: it stops the chain immediately (including mid-retry-delay) and is never recorded as a backend failure.
- Health is passive and process-local: quota/rate-limit failures cool a backend down (~15 min, less when `Retry-After` says so), transient network/upstream failures cool exponentially (30 s → 5 min cap), auth/config failures park the backend until the relevant credential/settings state changes; success clears; a restart clears everything. Diagnostics keep the last 20 searches in memory with metadata only (no queries, results, URLs, or bodies).
- Chain exhaustion surfaces one sanitized failure ("no configured search backend succeeded"); the detailed ordered trail goes to the host logger only. No custom session-event types are ever written.
- Zero DSH imports in the package (seam error codes ride the open-string `code` convention), so tests are fully hermetic.

## Development

```sh
cd packages/dsh-web-search-router
node --test test/*.test.js
```

No network, no installs. All HTTP clients, clocks, and schedulers are injected.

## License

MIT © S2P2
