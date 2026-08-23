# @s2p2/dsh-web-search-router

Model-conditional web search for DSH behind the native `web_search` tool. One
`WebSearchProvider` on the `ctx.web` seam routes each search by the calling
session's model, then walks a deterministic fallback chain — all in-package:

| Backend | Wire | Key | Serves when |
|---|---|---|---|
| `codex` | Codex standalone search (`chatgpt.com/backend-api/codex/alpha/search`) | shared dsh-codex OAuth document (`$DSH_HOME/.openai-codex-auth.json`) | active model is `openai-codex/*` |
| `zai` | z.ai Web Search REST (`api.z.ai/api/paas/v4/web_search`, engine `search-prime`) | `ZAI_API_KEY` | active model is `zai/*` |
| `exa` | Exa search API | `EXA_API_KEY` | fallback chain, first keyed hop |
| `tavily` | Tavily search API | `TAVILY_API_KEY` | fallback chain |
| `ddg` | DuckDuckGo HTML (keyless scrape) | — | fallback chain, free tier |
| `searxng` | SearXNG instances (`format=json`, keyless) | — | fallback chain, free tail |

Every result carries a provenance note naming the backend that served it plus
any skipped or failed hops (`Note: served by zai; failed codex (HTTP 429).`).
Any failure class (network, timeout, 401, 429, 5xx) rotates to the next hop; a
429 with `Retry-After` cools that backend down for subsequent searches; a
backend whose key (or Codex credential) is absent is skipped with a note, not
fatal.

Spec of record: [S2P2/dsh-lab#8](https://github.com/S2P2/dsh-lab/issues/8).
Model-detection decision: [ADR 0002](../../docs/adr/0002-web-search-router-model-detection.md) —
the calling model is read per search from `ctx.agents.currentInitiator()` plus
the session's latest `request/header`, so concurrent sessions on different
models each get their own first hop, and a mid-session model switch takes
effect on the next search.

## How it works

- **Chain ownership is in-package.** The `ctx.web` seam is single-select with
  no provider-to-provider calls (a provider invoking `ctx.web.search()` would
  recurse into itself), so the router implements every backend itself and never
  receives the seam — the recursion guard is structural.
- **Codex auth reuses the pi-ai pattern** over the same document the installed
  dsh-codex plugin maintains (strict JSON, owner-only mode, cross-process file
  lock, refresh through pi-ai's store — never hand-rolled). Login/logout is
  dsh-codex's job; this package only reads and refreshes.
- **Keys resolve per search** through the credentials service (`.env` layer,
  credential store) with a process-env fallback, so no secret is ever cached or
  tracked.

## Config

All policy lives on the plugin row (profile patch YAML); defaults encode the
chain above. Retuning is a config edit, not a release:

```yaml
- id: dsh-web-search-router
  name: '@s2p2/dsh-web-search-router'
  config:
    modelRoutes: { openai-codex: codex, zai: zai }
    fallbackChain: [exa, tavily, ddg, searxng]
    codex: { model: gpt-5.6-sol, mode: cached, contextSize: medium, maxOutputTokens: 10000 }
    zai: { apiKeyEnv: ZAI_API_KEY, engine: search-prime }
    exa: { apiKeyEnv: EXA_API_KEY }
    tavily: { apiKeyEnv: TAVILY_API_KEY }
    searxng: { instances: [] }        # empty → public instance list
    requestTimeoutMs: 15000
```

Select it as the `web_search` backend with the profile-patch override (the
patch layer applies after every bundle layer, so it beats every plugin's own
pin):

```yaml
- id: web
  config:
    searchProvider: web-search-router
```

## Install

Dogfood (local path): `dsh plugin --profile web add ../dsh-lab/packages/dsh-web-search-router`,
then restart `dsh web`. Once published: `dsh plugin --profile web add @s2p2/dsh-web-search-router`.

## Development

```sh
pnpm --filter @s2p2/dsh-web-search-router test
```

Tests are hermetic: routing/rotation/cooldown run against fake backends, wire
shapes against an injected `fetch` — no network, no sockets. The only test seam
is the `WebSearchProvider` interface (`available()` + `search()`).

## Layout

- `src/router.js` — pure routing core: attempt planning (longest provider-prefix
  match), rotation, cooldowns, provenance notes. No DSH imports.
- `src/backends.js` — one factory per backend; injectable `fetchImpl`; wire
  errors carry `.status` / `.retryAfterMs`.
- `src/model-context.js` — ADR 0002 read path: initiator → request header →
  tracked-agents fallback.
- `src/codex-auth.js` — vendored dsh-codex store pattern over the shared OAuth
  document + pi-ai refresh facade.
- `src/index.js` — host entry: config schema, key resolvers, registration.
