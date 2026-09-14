# @s2p2/dsh-web-search-router

One stock `web_search` tool for DeepSeek Harness (DSH) over an ordered fallback chain of search backends: **Exa → Tavily → Codex → z.ai → SearXNG → DuckDuckGo** (default order; reorderable in Settings once the settings card lands). The router tries backends sequentially, stops at the first result with at least one usable HTTP(S) source, and keeps a keyless DuckDuckGo tail so search survives paid-backend quota exhaustion. Spec of record: [S2P2/dsh-lab#8](https://github.com/S2P2/dsh-lab/issues/8).

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

> **Important:** while this router owns the search route, `dsh-codex-connect`'s `enableSearch` option must stay `false`. If switched on, that plugin takes over the profile's entire search route at runtime and this router silently stops serving `web_search`.

## Status

Tracer-bullet stage (ticket #86): router core + keyless DuckDuckGo hop. Failure policy/retries, health/cooldowns, keyed hops (Exa/Tavily), SearXNG, Codex (wrapping `dsh-codex-connect` exports), z.ai, Settings host, and the Settings card land as follow-up tickets of spec #8.

## Design notes

- One `WebSearchProvider` registered on `ctx.web` (id `web-search-router`). The router never receives or calls the seam itself — no provider-to-provider recursion.
- Internal adapters throw failures from a closed vocabulary (`config`, `auth`, `quota`, `rate_limit`, `timeout`, `network`, `upstream`, `malformed`, `empty`); the router owns order, deadlines, retries, and health.
- Caller cancellation is terminal: it stops the chain immediately and is never recorded as a backend failure.
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
