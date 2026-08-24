# Web-search router prior art and reuse map

Researched 2026-08-24 for [issue #8](https://github.com/S2P2/dsh-lab/issues/8), after the configurable multi-backend router design was confirmed. Discovery started from [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) and this repo's [`dsh-plugin-landscape.md`](../agents/dsh-plugin-landscape.md); claims below were then checked against the linked repositories or first-party DSH/provider documentation. The catalog is an index, not the authority for implementation details.

The goal of this note is implementation leverage: identify code and patterns that can be **used directly**, **adapted**, or **studied but deliberately not copied** for the six-backend Router in issue #8.

## Executive recommendation

Do **not** build all six adapters and the surrounding DSH plumbing from scratch. The lowest-risk implementation is a composition of proven prior art:

| Router area | Best reference | Recommendation |
|---|---|---|
| Codex adapter | [`Yan-Zero/dsh-codex`](https://github.com/Yan-Zero/dsh-codex) | **Use as a dependency / wrap public exports.** Do not copy OAuth/search implementation. |
| SearXNG adapter | [`rogerdigital/dsh-searxng`](https://github.com/rogerdigital/dsh-searxng) | **Adapt almost directly.** Its one-self-hosted-instance policy already matches issue #8. |
| Tavily adapter | [`240xu/dsh-websearch`](https://github.com/240xu/dsh-websearch) | **Adapt the isolated Tavily backend.** Replace generic `WebError` mapping with Router failure kinds. |
| Exa adapter | [`fno2010/dsh-web-search-ext`](https://github.com/fno2010/dsh-web-search-ext) + superseded PR #9 | **Adapt keyed REST path only.** Do not add anonymous MCP fallback in v1. |
| DuckDuckGo adapter | [`240xu/dsh-websearch`](https://github.com/240xu/dsh-websearch) + superseded PR #9 | **Adapt HTML parser and redirect decoding; retain PR #9 anti-bot detection.** |
| z.ai adapter | [Z.AI Search MCP docs](https://docs.z.ai/devpack/mcp/search-mcp-server) + [`oh-my-pi` Z.AI provider](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/web/search/providers/zai.ts) + superseded PR #9 | **Adapt the protocol logic, not a model-facing MCP plugin.** No DSH catalog entry found that already provides the exact hidden-adapter shape. |
| Sequential Router | [`Walvez/dsh-search-failover`](https://github.com/Walvez/dsh-search-failover) | **Adapt orchestration shape, not policy values/features.** It is the closest DSH Router prior art. |
| Health/cooldowns | `Walvez/dsh-search-failover` + `fno2010/dsh-web-search-ext` | **Reuse state-machine ideas; implement issue #8 policy separately.** |
| Settings host | [official DSH settings cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.md) | **Use official `installSettingsSection` directly.** Do not copy community shims. |
| Settings client | official DSH cookbook + this repo's [`dsh-quota-bar`](../../packages/dsh-quota-bar) packaging | **Reuse local package shape and official slot pattern.** |
| Credentials | [official DSH credential seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/credentials.md) | **Use directly.** Resolve fixed credential refs per operation; no second env/store layer. |
| Adapter module layout | `240xu/dsh-websearch` | **Copy the structural idea:** one backend module each plus shared generic helpers. |
| Router tests | Walvez, 240xu, rogerdigital, PR #9 | **Reuse injected-adapter/fetch fixture style.** Keep CI hermetic. |

The main new code should therefore be the **generic policy layer**: ordered settings snapshot, failure taxonomy, retry/deadline budget, health state, bounded diagnostics, and the thin wrappers that translate reused adapters into the internal `SearchAdapter` contract.

---

## 1. Closest complete Router: Walvez/dsh-search-failover

Sources:

- Catalog entry: <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/Walvez__dsh-search-failover.yml>
- Provider: <https://github.com/Walvez/dsh-search-failover/blob/main/lib/provider.js>
- Circuit breaker: <https://github.com/Walvez/dsh-search-failover/blob/main/lib/circuit.js>
- Settings host: <https://github.com/Walvez/dsh-search-failover/blob/main/lib/settings-host.js>

This is the closest existing DSH implementation to issue #8. It registers one search-pool provider, reads an ordered backend configuration, skips open circuits, attempts backends sequentially in failover mode, stops on success, treats caller abort specially, exposes a read-only state snapshot for the UI, and keeps circuit state in memory.

### Worth adapting

- The Router owns backend adapters rather than recursively calling `ctx.web.search()`.
- `resolveConfig()` is read at request time, so configuration can apply live without rebuilding the provider.
- A backend registry is injectable, making deterministic Router tests straightforward.
- Provider health is process-local and keyed by backend identity.
- `state()` is a useful precedent for producing a safe UI-facing health snapshot independent of the actual search result.
- Success clears failure state; an open backend is skipped before a network request.

### Do not carry over

Walvez solves a wider problem than issue #8. Its rotate strategy, multi-key pooling, targeted model-facing source selection, cross-provider merge threshold, fetch routing, custom backends, and secret-bearing settings are explicitly outside our v1. Its circuit policy also differs: transient failures accumulate inside a burst window and only open after a threshold, while issue #8 calls for immediate short exponential cooldowns for network/upstream failures and a different quota/rate-limit policy.

**Implementation use:** model `router.ts` and `health.ts` after the shape of this code, but write the policy from issue #8 rather than porting the class unchanged.

---

## 2. Best module decomposition: 240xu/dsh-websearch

Sources:

- Repository: <https://github.com/240xu/dsh-websearch>
- Provider: <https://github.com/240xu/dsh-websearch/blob/main/lib/provider.js>
- Tavily: <https://github.com/240xu/dsh-websearch/blob/main/lib/backends/tavily.js>
- DuckDuckGo: <https://github.com/240xu/dsh-websearch/blob/main/lib/backends/ddg.js>
- Generic MCP helper: <https://github.com/240xu/dsh-websearch/blob/main/lib/util/mcp-client.js>

The top-level search behavior is intentionally opposite our design: it fans out concurrently and merges results. The useful part is its **locality**. Each backend lives in its own module, and shared abort/MCP/logging concerns are separated from provider-specific parsing.

### Tavily: strong direct adapter reference

Its Tavily backend already:

- resolves the key for each operation rather than storing a resolved secret in the adapter;
- POSTs the documented Tavily search endpoint;
- maps Tavily's generated `answer` into `content` rather than inventing a fake source;
- maps result URL/title/content into the DSH source shape;
- honors caller cancellation.

For our adapter, retain those wire and normalization choices, but translate HTTP/network/malformed/empty cases into the Router's internal failure taxonomy. The Router, not the adapter, owns retry/cooldown policy.

### DuckDuckGo: good parser reference

Its DDG backend uses the HTML endpoint, decodes the `uddg` redirect target, strips tags, and extracts title/snippet. That is a good small parser to adapt. Superseded PR #9 has one additional useful hardening step: it recognizes HTTP 202 / anti-bot challenge HTML as a rate-limit-like failure instead of returning an empty result. Preserve that behavior in the new DDG adapter.

### Generic MCP helper: useful, but not directly usable for z.ai

`lib/util/mcp-client.js` demonstrates session caching, initialize → initialized → tools/call, SSE/JSON parsing, and stale-session reinitialization. However, its extra headers are only applied on `tools/call`, not on the initialization handshake. Z.AI requires the Bearer credential on its MCP requests, so this helper cannot be dropped in unchanged for the z.ai adapter.

**Implementation use:** copy the module organization and selected parsers, not the concurrent provider.

---

## 3. SearXNG is nearly solved already: rogerdigital/dsh-searxng

Sources:

- Repository: <https://github.com/rogerdigital/dsh-searxng>
- Provider: <https://github.com/rogerdigital/dsh-searxng/blob/main/src/provider.ts>
- Tests: <https://github.com/rogerdigital/dsh-searxng/blob/main/test/provider.test.ts>

This plugin independently arrived at almost exactly our confirmed SearXNG policy:

- one explicitly configured base URL;
- no baked-in public instances;
- unavailable when the URL is absent/invalid;
- JSON API via `/search?format=json`;
- URL/title/content/published-date normalization;
- caller abort distinction;
- base-URL validation restricted to HTTP(S), with query/fragment rejected;
- practical diagnostics for 403 (JSON format often disabled) and 429.

The README/source explicitly explains why public SearXNG defaults are a poor assumption: many public deployments disable the JSON response format or rate-limit heavily. That supports issue #8's self-hosted-only decision.

### Adaptation delta

- Convert `WebError` outcomes into our internal failure kinds.
- Apply Router attempt/deadline signal rather than introducing another timeout.
- Apply our common URL normalization/dedup helper.
- Ensure the final `maxResults` behavior follows the stock Router normalization path.
- Keep only the base URL in v1 unless we intentionally decide to expose language/engines/categories/auth-header knobs later.

**Implementation use:** this should be the least novel adapter in the package.

---

## 4. Codex can be reused as a public module, not reimplemented

Sources:

- Repository: <https://github.com/Yan-Zero/dsh-codex>
- Public exports: <https://github.com/Yan-Zero/dsh-codex/blob/main/src/index.ts>
- Standalone search provider: <https://github.com/Yan-Zero/dsh-codex/blob/main/src/search.ts>
- OAuth store: <https://github.com/Yan-Zero/dsh-codex/blob/main/src/store.ts>
- Package exports/license: <https://github.com/Yan-Zero/dsh-codex/blob/main/package.json>

This is more reusable than PR #9 assumed. Current `dsh-codex` exports from the package root:

- `OpenAICodexSearchProvider`;
- `OpenAICodexCredentialStore`;
- `mapOpenAICodexSearchResponse`;
- the standalone search URL and defaults;
- the provider-owned Codex service and auth helpers.

Its search provider already owns the difficult pieces: refreshable OAuth through `pi-ai`, account-id extraction, the official standalone search request shape, caller cancellation, provider-message redaction, result validation, HTTP(S)-source filtering, URL deduplication, and 401/403 reauthentication semantics.

### Recommended integration

Make our `codex` Search Adapter a **thin wrapper** over `OpenAICodexSearchProvider` rather than vendoring that code. The wrapper should:

1. construct/use the exported credential store (or reuse the `openAICodex` service's store if we later choose an optional-service integration);
2. delegate one search to the exported provider;
3. translate `WebError` codes/status context into our `auth`, `network`, `upstream`, `malformed`, etc. failure kinds;
4. enforce the Router's common source-validity rule after normalization.

Importing the package root does not itself require invoking its Cordis `apply()` function. The public provider/store exports are therefore usable as implementation dependencies without exposing Codex-specific tools to the model.

`dsh-codex` is Apache-2.0. Depending on the package is cleaner than copying its implementation into this MIT repo; if any source is copied instead, preserve the applicable Apache notices/license obligations.

**Implementation use:** this is the largest opportunity to delete custom code from the new Router compared with PR #9.

---

## 5. z.ai: reuse protocol knowledge, keep a small private adapter

Primary sources:

- Z.AI Search MCP documentation: <https://docs.z.ai/devpack/mcp/search-mcp-server>
- Concrete mature implementation: <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/web/search/providers/zai.ts>
- Our superseded implementation: <https://github.com/S2P2/dsh-lab/pull/9>

The Awesome DSH catalog currently exposes z.ai-related tools/providers, but this research did not find a DSH plugin that already implements the exact shape we need: **a private z.ai Search Adapter behind the stock `ctx.web` Router without model-facing MCP tools**. `dhicoc/dsh-codex-web-search-mcp`, for example, is useful evidence for MCP integration but intentionally registers MCP tools for the model, which conflicts with issue #8.

Z.AI's first-party docs confirm the remote Streamable-HTTP endpoint:

`https://api.z.ai/api/mcp/web_search_prime/mcp`

with Bearer authentication and a standard MCP-compatible client flow.

`oh-my-pi` is useful implementation prior art because it handles several real-world details in one isolated provider:

- authenticated initialize / initialized / tools-call lifecycle;
- `Mcp-Session-Id` propagation;
- both SSE `data:` and plain JSON envelopes;
- JSON-RPC errors and tool-level `isError`;
- multiple argument shapes observed across server versions (`query`, then `search_query`, then `search_query` + `search_engine`);
- result payloads that may appear directly, under `search_result`/`results`, or JSON-encoded inside MCP text content, including an extra stringification layer;
- mapping `link`/`url`, title, content, and publication date.

### Recommended integration

Do not introduce a general public MCP subsystem for this Router. Implement a small z.ai-specific private client/adapter using the official protocol and the proven parsing cases above. Reuse the superseded PR #9 code where it already matches those cases, but replace its generic errors/timeouts with the new Router failure taxonomy and deadline signal.

Protocol repair (dropped/stale session → reinitialize once) stays inside this adapter and does not consume the Router's transient retry, exactly as issue #8 specifies.

**Implementation use:** adapt behavior, not the external tool surface.

---

## 6. Exa: keyed REST is already implemented several times

Sources:

- Catalog entry for a dedicated Exa plugin: <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/TonyDua__dsh-web-search-exa.yml>
- `TonyDua/dsh-web-search-exa`: <https://github.com/TonyDua/dsh-web-search-exa>
- `fno2010/dsh-web-search-ext`: <https://github.com/fno2010/dsh-web-search-ext>
- `240xu/dsh-websearch` Exa MCP implementation: <https://github.com/240xu/dsh-websearch/blob/main/lib/backends/exa.js>

Three independent plugins support Exa, including anonymous hosted MCP access. That is useful evidence that Exa can have a keyless path, but **issue #8 intentionally defines Exa by the fixed `EXA_API_KEY` credential reference** and keeps SearXNG/DDG as the free tail. Adding anonymous Exa MCP would change routing/cost assumptions and should not sneak into implementation.

For v1, adapt only the keyed REST path from `fno2010/dsh-web-search-ext` or PR #9:

- Bearer `EXA_API_KEY`;
- `POST https://api.exa.ai/search`;
- `type: auto` and requested result count;
- highlights/snippet + title + published date normalization.

One correction to community implementations: do not require a highlight/snippet for a result to survive if it has a valid citeable URL. The stock DSH source contract only requires `url`; title/snippet/date are optional, and issue #8 says to map them “when available.”

**Implementation use:** reuse the wire shape; keep result validation aligned with the Router contract.

---

## 7. Settings and credentials: prefer DSH first-party seams over community copies

Primary sources:

- DSH settings-card cookbook: <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.md>
- DSH credentials subsystem: <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/credentials.md>
- Current community integration example: <https://github.com/fno2010/dsh-web-search-ext>
- This repo's dual-face package example: <https://github.com/S2P2/dsh-lab/tree/main/packages/dsh-quota-bar>

The current official DSH pattern already matches our spec:

- Host and browser halves live in the same package.
- The Host registers a plugin-owned settings namespace with `installSettingsSection`.
- Composition config is the base layer; user settings are the editable layer.
- Live settings changes can update the source used by subsequent searches.
- The browser card registers in `settings.plugin.item` under the same namespace.
- `ctx.settingsScope` handles revision-fenced writes.
- Credential references are resolved per operation, and `describe()` exposes configured/source/writable facts without returning the secret.

`fno2010/dsh-web-search-ext` is useful as a recent community example that actually combines `installSettingsSection`, a client settings surface, `credentialRef`, and one `ctx.web` provider. However, it also supports literal secrets and an extra launch-environment fallback. Do not copy those layers: issue #8 should use fixed credential refs (`EXA_API_KEY`, `TAVILY_API_KEY`, `ZAI_API_KEY`) through `ctx.credentials` only.

For package wiring, `packages/dsh-quota-bar` already demonstrates this repo's simple `./client` export plus `dsh.client` manifest. Reuse that local convention while following the newer official Settings slot APIs for the actual card.

**Implementation use:** first-party DSH docs are the implementation authority; community settings code is only a worked example.

---

## 8. Health, retry, and diagnostics: reuse shapes, not policy

Useful sources:

- Walvez circuit state: <https://github.com/Walvez/dsh-search-failover/blob/main/lib/circuit.js>
- Walvez provider state snapshot: <https://github.com/Walvez/dsh-search-failover/blob/main/lib/provider.js>
- fno2010 per-backend 429 cooldown: <https://github.com/fno2010/dsh-web-search-ext/blob/main/lib/index.js>

No researched plugin exactly implements issue #8's combination of:

- one transient retry only for transport/502/503/504;
- timeout = immediate fallback;
- 5-second attempt budget and 15-second overall budget;
- Retry-After-aware rate/quota cooldown;
- immediate short exponential network/upstream cooldown (about 30s → max 5m);
- long default rate/quota cooldown when reset data is missing;
- 20-search content-free diagnostic ring.

That policy should remain new Router code. Prior art still helps with the shape:

- one `Map` keyed by stable backend ID;
- cheap `isOpen`/status read before network work;
- success reset;
- a safe state projection for the Settings UI;
- no persistence.

A fixed-size ring buffer for the 20 most recent search executions is simpler than borrowing any existing telemetry framework.

---

## 9. What not to adapt even though it exists

These are attractive pieces of prior art that conflict with the confirmed v1 and should be left out unless the spec is explicitly reopened:

- **Concurrent fan-out / result aggregation** — central behavior of `240xu/dsh-websearch`.
- **Rotate/load-balance strategy** — `Walvez/dsh-search-failover`.
- **Cross-provider merge thresholds** — Walvez.
- **Model-facing backend selector tools** — Walvez and several MCP plugins.
- **`web_fetch` routing** — Walvez/free-search plugins; issue #8 is search-only.
- **Firecrawl** — `fno2010/dsh-web-search-ext`; deferred by issue #8.
- **Anonymous Exa MCP fallback** — TonyDua/fno2010/240xu; useful later, but changes v1's configured Exa semantics.
- **Public SearXNG instance pools** — some search plugins and superseded PR #9; contradicted by our self-hosted-only decision and `dsh-searxng`'s operational evidence.
- **Multi-key pooling / rotation** — Walvez and Tavily-specific plugins; out of scope.
- **Secrets stored directly in Router settings** — several community plugins; use the DSH credential seam instead.
- **Provider-specific routing metadata appended to model content** — not part of the stock search result contract we confirmed.

---

## 10. Suggested implementation source map

If an implementation agent starts from issue #8, the most efficient source-to-module mapping is:

### `router` / policy

Start from the sequential control-flow ideas in Walvez `SearchPoolProvider`, but implement only:

1. snapshot ordered enabled providers;
2. local availability/status skip;
3. health skip;
4. bounded attempt + optional one retry;
5. validate normalized result;
6. first success return;
7. record safe diagnostic attempt summary;
8. sanitized chain exhaustion.

Do not port rotate, source targeting, merge, key pools, or fetch.

### `health`

Use Walvez's small per-ID state-map style. Replace threshold/burst-window logic with issue #8's explicit failure-kind policy and Retry-After handling.

### `settings`

Use official DSH `settingsNamespace` + `installSettingsSection`; make the ordered provider list the single source of truth. Use a live source function and snapshot it once at Router request start.

### `client`

Use the official `settings.plugin.item` pattern. The UI only needs:

- reorder controls;
- enabled switch;
- Ready / Needs setup / Cooling down / Disabled status;
- one SearXNG URL field;
- global attempt/overall/retry controls;
- credential configure/status actions;
- latest diagnostic executions.

Avoid turning this into a general search-engine management console.

### `adapters/codex`

Wrap `dsh-codex` public `OpenAICodexSearchProvider` and `OpenAICodexCredentialStore`; translate errors.

### `adapters/zai`

Use the official MCP endpoint and adapt the proven `oh-my-pi`/PR #9 handshake + parser. Keep session repair internal.

### `adapters/exa`

Adapt keyed REST from fno2010 or PR #9. Resolve `EXA_API_KEY` through `ctx.credentials` per operation.

### `adapters/tavily`

Adapt 240xu's isolated REST backend. Resolve `TAVILY_API_KEY` per operation; keep Tavily answer as `content`.

### `adapters/searxng`

Adapt `rogerdigital/dsh-searxng` provider logic nearly directly, trimmed to one base URL and common Router normalization/errors.

### `adapters/duckduckgo`

Adapt 240xu parser + PR #9 anti-bot handling.

### `errors`, `deadline`, `diagnostics`

Write these from the confirmed issue #8 contract; no researched plugin is a closer fit than the spec itself.

---

## 11. Licensing / copying guidance

Repositories examined for likely code reuse:

- `Walvez/dsh-search-failover` — MIT.
- `240xu/dsh-websearch` — MIT.
- `rogerdigital/dsh-searxng` — MIT.
- `fno2010/dsh-web-search-ext` — MIT.
- `TonyDua/dsh-web-search-exa` — MIT.
- `Yan-Zero/dsh-codex` — Apache-2.0.

Prefer dependencies or small adapted implementations over wholesale copying. For Codex specifically, the package already exposes the exact reusable modules, so wrapping the dependency is cleaner than copying Apache-licensed source. When code is materially copied/adapted from any repository, preserve the required license/attribution and record the source in the implementation PR.

---

## 12. Research conclusion

The revised Router is not a greenfield search stack. Most backend-specific complexity is already proven elsewhere:

- Codex: **direct public module reuse**;
- SearXNG: **near-direct adapter adaptation**;
- Tavily/DDG: **small isolated adapter adaptation**;
- Exa: **proven REST wire adaptation**;
- z.ai: **proven MCP behavior adaptation**, with our own private DSH wrapper;
- Settings/credentials: **official DSH seams**;
- failover/health shape: **existing DSH Router prior art**.

The genuinely new part—and therefore where implementation/review attention should concentrate—is the compact generic Router policy that issue #8 specifies: ordered first-success fallback, failure classification, bounded retry/deadline behavior, passive health, and content-free diagnostics.

This should materially reduce the implementation risk compared with rebuilding PR #9 wholesale: use proven backend modules where their contracts line up, and write new code only where the confirmed design is actually different.
