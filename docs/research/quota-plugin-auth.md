# 2026-08-22 · How third-party DSH quota/usage plugins obtain the API key

Research question: how do third-party DSH (DeepSeek Harness) quota/usage plugins get the
API key they need to query provider quota endpoints — in particular for Z.ai / GLM /
Zhipu Coding Plan — and how does that relate to the MCP-client env-bridge approach
(`@deepseek-ai/dsh-mcp-client` taking plain string config, which cannot read the
credentials store)?

Method: fetched each plugin's source from GitHub (`codeload.github.com` tarball of the
default branch, all `main`) into `.tmp-research/`, read the actual host-side source.
Reference for the seam API: the shipped `@deepseek-ai/dsh-credentials@0.1.1-rc.2` /
`dsh-credentials-local` packages in the local harness install. No secrets were found in
any repo (the only long hex strings are git commit SHAs in URLs); nothing needed redaction.

## Reference: what `ctx.credentials` actually exposes

From `@deepseek-ai/dsh-credentials` / `@deepseek-ai/dsh-credentials-local`
(local install, `node_modules/@deepseek-ai/dsh-credentials{,-local}/lib/`):

- Service name `credentials` (`super(ctx, "credentials")`), consumed as `ctx.credentials`
  (with `inject: ['credentials']`) or optionally via `ctx.get('credentials')`.
- `resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>` — a ref is a
  POSIX env-var **name** (`credentialRef('ZAI_API_KEY')` brands it). The local provider
  layers: inherited process env > `~/.dsh/.credentials.yaml` (`refs:` map) > project `.env`
  > `$DSH_HOME/.env`. Returns `{ value, source }`; an empty stored value counts as absent.
- Writes: `set(ref, value)` / `unset(ref)`; record half `readRecord/modifyRecord/...` for
  `<scope>/<id>` keys (used by OAuth grants).
- Events: `credentials/reference-updated` (refs) and `credentials/record-updated` (records).
- Design rule (package doc): config surfaces carry *references*, consumers "resolve a
  reference once per operation, so a changed credential reaches the next operation without
  any plugin restart, and configuration surfaces describe a reference without ever seeing
  its value."

Stock `@deepseek-ai/dsh-mcp-client` (same install) has no seam access: its config is
plain strings — `env:` mappings for stdio servers, whose README examples interpolate
`!!js process.env.GITHUB_TOKEN` at config-load time. That is the gap the launch-script
env bridge filled.

---

## 1. BeiZi6/dsh-opencodego-usage (OpenCode Go — not Z.ai)

**Pattern: layered fallback — explicit key > `ctx.credentials.resolve` (ref name taken
from `apiKeyEnv` in settings) > `process.env` > plaintext state file.**

Evidence — `index.js` (repo root, no src dir), `resolveKey()`:

```js
// index.js:44-48 — ref NAME discovered from DSH settings, not hardcoded
let ref = 'OPENCODE_GO_API_KEY'
const settings = ctx.get('settings')
const cfg = settings && typeof settings.get === 'function' ? settings.get('llm-pi-ai') : null
const p = cfg && cfg.providers ? cfg.providers['opencode-go'] : null
if (p && typeof p.apiKeyEnv === 'string' && p.apiKeyEnv.trim()) ref = p.apiKeyEnv.trim()
// index.js:50-56 — the credentials seam, optional service
const creds = ctx.get('credentials')
if (creds && typeof creds.resolve === 'function') {
  const hit = await creds.resolve(ref)
  const value = hit && typeof hit.value === 'string' ? hit.value.trim() : ''
  if (value) return value
}
// index.js:58-60 — process env fallback
const value = process.env[ref]
```

- It only auto-reads the key when the *current default model's* provider is `opencode-go`
  (or unknown), checked via `ctx.get('agentDefaultModel').currentSelection()` (index.js:36-42).
- **Endpoint/auth**: `https://opencode.ai/zen/go/v1/usage` (+ fallbacks
  `opencode.ai/api/v1/usage`, `api.opencode.ai/v1/usage`), `Authorization: Bearer <key>`.
  The HTTP call is made by shelling out — `execFile('curl.exe', ['-sS', ..., '-H',
  'Authorization: Bearer ' + apiKey, ...])` (index.js:23-26) — hardcoded to the Windows
  curl binary.
- **Does the value land in config/logs?** Worse than config: a key typed into the panel
  travels as a URL query param (`/opencodego-usage?key=...`, client.js:148-149) and is then
  **persisted in plaintext** to `~/.dsh/.ocg-state.json` (`writeFileSync(STATE_PATH,
  JSON.stringify({ apiKey: explicit }))`, index.js:177-179), which is also the last-resort
  key source (index.js:64-68). The key also sits in the curl argv (visible in a process
  list). This is the only plugin of the six where a key value can persist outside the
  credentials store.

## 2. Minokun/dsh-quota (Zhipu Coding Plan ✓)

**Pattern: full credentials-seam citizen — reads *and writes* the store; ref names mirror
DSH providers' `apiKeyEnv`; `process.env` fallback; MCP adapters for cookie-based
platforms.**

Evidence — `src/controller.ts`:

```ts
// src/controller.ts:11-12 — imports the real seam package for branding
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
// src/controller.ts:136-148 — resolve chain: seam first, env second
async function resolveKey(credentials, refs, envKeys) {
  if (credentials) {
    for (const ref of refs) {
      const resolved = await credentials.resolve(credentialRef(ref))
      if (resolved?.value) return { value: resolved.value, ref, source: resolved.source }
    }
  }
  for (const envKey of envKeys) {
    const v = process.env[envKey]?.trim()
    if (v) return { value: v, ref: envKey, source: 'env' }
  }
}
// src/controller.ts:410-421 — the panel's key manager WRITES through the seam
const credentials = this.getCredentials()
if (!credentials) throw new Error('凭证服务不可用')
await credentials.set(credentialRef(ref), trimmed)
...
await credentials.unset(credentialRef(ref))
```

- The service is obtained optionally (`() => ctx.get('credentials')`, `src/index.ts:47`);
  refs tried in order are "the `apiKeyEnv` names DSH's model providers use, so keys
  already added to DSH are picked up automatically" (controller.ts:132-134), one panel row
  **per resolved ref** (multi-account, controller.ts:242-253).
- **Z.ai/GLM endpoints & auth** — `src/direct.ts:392,400`:

  ```ts
  entry({ id: 'zhipu', label: '智谱 Coding Plan', keyRefs: ['ZAI_CODING_CN_API_KEY', 'ZHIPU_API_KEY', 'BIGMODEL_API_KEY', 'GLM_API_KEY'], endpoint: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit', format: 'zai-coding', ... }),
  entry({ id: 'zai', label: 'Z.AI Coding', keyRefs: ['ZAI_API_KEY'], endpoint: 'https://api.z.ai/api/monitor/usage/quota/limit', format: 'zai-coding', ... }),
  ```

  fetched host-side with `{ Authorization: \`Bearer ${key}\` }` (direct.ts:353, 445). The
  parser maps `TOKENS_LIMIT` entries (shortest = 5h window, longest = weekly) plus
  `TIME_LIMIT` (monthly search/MCP lane) — direct.ts:74-110.
- **Does the value land in config/logs?** No. The persisted `quota` settings namespace
  stores only `keyRef`/`keySource` *names* (config.ts header: "API keys never live
  here"); `keyStatus()` "Describe configured keys (never the values)" (controller.ts:486-498).
  Manual saves arrive over a same-origin route with a CSRF header (`POST /keys`,
  `src/http.ts`) and go straight into `credentials.set`. Cookie-style platforms without an
  API-key quota endpoint use MCP adapters + login flows (`afterLogin` shell hook re-syncs
  an MCP server's session cookie; config.ts:57-68) — auth never passes through this plugin.
- **Bug observation**: auto-sync listens on `ctx.on('credentials/updated', ...)`
  (index.ts:108) — an event name the shipped seam does not declare (it emits
  `credentials/reference-updated`; grep of the local install finds no `credentials/updated`
  anywhere). The refresh-on-change hook most likely never fires; boot/periodic refresh
  covers it in practice.

## 3. wenzetan/dsh-quota-panel (GLM ✓, auto-discovery)

**Pattern: hard-injected seam dependency (`inject: ['connection', 'credentials']`);
catalog auto-discovery by probing refs per cycle; per-fetch re-resolution; config carries
ref names only.**

Evidence — `src/index.ts`:

```js
// src/index.ts:83 — hard dependency: plugin waits for the seam
export const inject = ['connection', 'credentials'];
// src/index.ts:802-807 — auto-discovery: probe catalog refs each cycle
async function firstResolvedRef(ctx, refs) {
  for (const ref of refs) {
    const hit = await ctx.credentials.resolve(ref);
    if (hit && typeof hit.value === 'string' && hit.value.length > 0) return { ref, value: hit.value };
  }
  return null;
}
// src/index.ts:961-963,1012 — per-row request-time resolution, Bearer auth
const hit = await ctx.credentials.resolve(provider.credential);
if (!hit || ...) return { id: provider.id, error: `${provider.credential} is not configured` };
...
const headers = { authorization: `Bearer ${hit.value}` };
```

- Header comment states the invariant: "API keys are resolved through `ctx.credentials`
  and never reach the browser; upstream quota endpoints are called host-side" (index.ts:9-13).
  Since v0.5 even upstream JSON stays host-side (normalized view models), "so the browser
  half renders generic rows and upstream schema details stay host-side like the
  credentials" (index.ts:20-23).
- **Z.ai/GLM catalog** — `src/index.ts:269-271`:

  ```js
  { id: 'zhipu', label: 'ZhiPu GLM', refs: ['ZHIPU_API_KEY', 'GLM_API_KEY'], endpoint: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit', format: 'zhipu-quota' },
  { id: 'zai-coding-cn', label: 'ZhiPu GLM Coding', refs: ['ZAI_CODING_CN_API_KEY'], endpoint: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit', format: 'zai-coding-quota', ... },
  { id: 'zai', label: 'Z.AI GLM Coding', refs: ['ZAI_API_KEY'], endpoint: 'https://api.z.ai/api/monitor/usage/quota/limit', format: 'zai-coding-quota', ... },
  ```

- Explicit config rows name a *reference*: `credential: credential reference, e.g.
  "DEEPSEEK_API_KEY"` (index.ts:53). Two-credential rows exist: Volcengine resolves both
  `VOLC_ACCESS_KEY` and `VOLC_SECRET_KEY` and signs requests (HMAC-SHA256, "signed, not
  Bearer", index.ts:965-990). "The resolved ref NAME is stored (not the value); fetchRow
  re-resolves per cycle" (index.ts:825-827).
- **Does the value land in config/logs?** No — only ref names in config/rows/errors
  (`${provider.credential} is not configured`).

## 4. Ychris12138/dsh-usage-stats (Z.ai ✓)

**Pattern: hard-injected seam dependency; refs discovered from harness settings
(`llm-pi-ai`/`llm-deepseek` providers' `apiKeyEnv`), per-monitor `credentialRef` config
override; "nothing is stored by this plugin". Plus one first-party-file fallback.**

Evidence — `lib/index.js` (compiled JS is the shipped source):

```js
// lib/index.js:41 — seam is a hard requirement among five services
const inject = ["webServer", "credentials", "sessions", "sessionPersistence", "settings", "llm"];
// lib/index.js:11-14 (docblock) — provider config read from harness settings,
// "each provider's API key is resolved through the credentials seam at request time —
//  nothing is stored by this plugin"
// lib/accounts.js:125-131 — the one choke point every adapter funnels through
async function resolveCredential(credentials, ref) {
  if (nonEmptyString(ref) === null || credentials === null || ...) return "";
  try {
    const hit = await credentials.resolve(ref);
    return nonEmptyString(hit?.value) ?? "";
  } catch { return ""; }
}
```

- Ref names come from the providers DSH already knows: `provider.apiKeyEnv` with monitor
  `credentialRef` override (accounts.js:293-303), e.g. the auto-added default
  `providers.push({ id: "zai", displayName: "Z.ai", apiKeyEnv: "ZAI_API_KEY", baseURL:
  "https://api.z.ai" })` (accounts.js:1183). Declarative monitors may name
  `request.auth?.credentialRef` (accounts.js:1093).
- **Z.ai endpoints & auth** — `lib/subscriptions.js`:

  ```js
  const ZAI_HOSTS = { global: "https://api.z.ai", "bigmodel-cn": "https://open.bigmodel.cn" };
  const ZAI_QUOTA_PATH = "/api/monitor/usage/quota/limit";
  const ZAI_SUBSCRIPTION_PATH = "/api/biz/subscription/list";
  ...
  const [apiKey, configuredRegion] = await Promise.all([
    resolveCredential(credentials, apiKeyRef),        // apiKeyRef ?? "ZAI_API_KEY"
    resolveCredential(credentials, REFS.zaiRegion)    // "ZAI_API_REGION" picks the host
  ]);
  // The Coding Plan endpoint expects the raw API key, unlike the inference API.
  const init = { headers: { authorization: apiKey, accept: "application/json" } };
  ```

  (subscriptions.js:30-31, 46-49, 368-381.) **Auth nuance**: the `authorization` header
  carries the **raw key without a `Bearer ` prefix** — unique among the six plugins —
  and this plugin is also the only one that additionally reads
  `GET /api/biz/subscription/list` for plan/renewal metadata.
- Extra pattern (e): the OpenCode Go adapter can fall back to reading the first-party
  client's credential file directly — `JSON.parse(await load(join(home, ".local", "share",
  "opencode", "auth.json"), "utf8"))` (subscriptions.js:225-226) — besides its
  `OPENCODE_GO_API_KEY` / `OPENCODE_GO_AUTH_COOKIE` refs.
- **Does the value land in config/logs?** No. The browser client even tells the user
  where to fix refs by name: `"balance.noCredential": "未配置 {ref}（请编辑
  ~/.dsh/.credentials.yaml）"` (lib/client.js:1348). Endpoints are loopback-fenced.

## 5. Physicolor/harness-widgets — same-origin host proxy (OpenCode Go; repo redirects to `Physicolor/dsh-widgets`)

**Pattern: the canonical minimal consumer — hard-injected seam, one hardcoded ref,
request-time resolve inside a same-origin proxy route; no key config field at all.**

Evidence — `src/index.ts` (repo root plugin, compiled to `lib/`):

```ts
// src/index.ts:21-22 — endpoint + ref are constants; there is no key config field
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const KEY_ENV = 'OPENCODE_GO_API_KEY'
// src/index.ts:26-27
/** Required services: the web server (route registration) and the credentials seam (API key). */
export const inject = ['webServer', 'credentials']
// src/index.ts:86-95 — resolve at request time inside the proxy handler
const resolved = await ctx.credentials.resolve(KEY_ENV)
const key = resolved?.value
if (key === undefined || key === '') {
  res.writeHead(503, ...); res.end(JSON.stringify({ error: `${KEY_ENV} is not configured` })); return
}
const upstream = await fetch(USAGE_URL, { headers: { Authorization: `Bearer ${key}` } })
```

- Rationale in the header: "the browser never issues a cross-origin request — the
  OpenCode API requires a Bearer header and does not allow browser CORS; the key resolves
  through the credentials seam, **the same key the Models settings page configures**"
  (index.ts:5-8). The proxy exists for CORS, and the seam supplies the key — the two
  concerns are handled by different mechanisms.
- **Z.ai/GLM**: none — OpenCode Go only.
- **Does the value land in config/logs?** No; error responses surface only the ref name
  (`OPENCODE_GO_API_KEY is not configured`).

## 6. FengHuoLinShan/dsh-plugin-llm-balance (GLM: listed but **no quota endpoint**)

**Pattern: seam for API-key providers + delegated OAuth for one provider. Correction to
the premise: GLM is NOT actually queryable here.**

Evidence — `lib/index.js` (compiled JS is the shipped source):

```js
// lib/index.js:44 — seam hard-injected
const inject = ["connection", "credentials", "sessionProjections"]
// lib/index.js:313-320 — the built-in provider→API table; NO glm/zhipu/zai entry
const PROVIDER_APIS = {
  deepseek: "deepseek", "deepseek-official": "deepseek",
  moonshotai: "moonshot", "moonshotai-cn": "moonshot",
  "kimi-coding": "kimi-coding", "opencode-go": "opencode-go",
  [OPENAI_CODEX_ID]: OPENAI_CODEX_API_KIND,
}
// lib/index.js:573-578 — resolve, then honest refusal for unlisted kinds
const hit = await ctx.credentials.resolve(apiKeyEnv)
if (!hit) return { configured: false, ref: apiKeyEnv }
if (!apiKind) return { configured: true, status: "no_balance_api" }
// lib/index.js:326-331 — Bearer for everything that does query
const response = await fetch(conf.path(baseURL), {
  headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" }, ... })
```

- A GLM/Zhipu route declared in `llm-pi-ai` settings *is* auto-discovered as a candidate
  and its key *is* resolved through the seam (`apiKeyEnv` from the provider profile,
  lib/index.js:590-592), but since `PROVIDER_APIS` has no entry for it the row returns
  `status: "no_balance_api"` and **no endpoint is called**. The README says exactly this:
  "llm-pi-ai 中声明的其他路由若无内置接口表，如实报告 `no_balance_api`，不误报配置错误"
  (README.md:46). Grepping the whole repo finds no glm/zhipu/bigmodel/z.ai endpoint anywhere.
- **OAuth delegation** (pattern d): `openai-codex` skips the seam entirely — "凭据访问
  完全由 codex-connect 封装" — a dynamic `import` of the optional peer package
  `dsh-codex-connect`, whose `OpenAICodexCredentialStore` reads the ChatGPT OAuth login
  state and calls `https://chatgpt.com/backend-api/wham/usage` inside that package
  (lib/index.js:13-19, 364-366). This plugin "绝不直接读取或复制 OAuth JSON" and returns
  `configured: false` when the peer is absent.
- Compat config keeps a single-provider `provider`/`apiKeyEnv` pair (lib/index.js:524) —
  the value is a ref *name*, and the docblock promises "失败只返回稳定错误码，绝不透出
  provider 响应体、Key 或 OAuth 凭据" (lib/index.js:32).
- **Does the value land in config/logs?** No — ref names only; errors are stable codes.

---

## Comparison

| Plugin | Key source for quota fetch | Pattern class | Z.ai/GLM endpoint | Auth header |
|---|---|---|---|---|
| BeiZi6/dsh-opencodego-usage | `ctx.get('credentials').resolve(ref)`, ref = `apiKeyEnv` from `llm-pi-ai` settings (default `OPENCODE_GO_API_KEY`); fallback `process.env[ref]`; explicit `?key=` → plaintext state file | (a)+(b ref-name)+(c)+(e state file) | — (OpenCode Go: `opencode.ai/zen/go/v1/usage`) | `Bearer` (via `curl.exe` argv) |
| Minokun/dsh-quota | `credentials.resolve(credentialRef(ref))` for a ref list per platform; `credentials.set/unset` for panel-managed keys; `process.env` fallback | (a) full read+write, (c) fallback | `open.bigmodel.cn` + `api.z.ai` `/api/monitor/usage/quota/limit` | `Bearer` |
| wenzetan/dsh-quota-panel | `inject: ['credentials']`; catalog auto-discovery by probing refs; `ctx.credentials.resolve(provider.credential)` per fetch cycle | (a) hard dep, (b ref-name in config) | `open.bigmodel.cn` (zhipu/zai-coding-cn) + `api.z.ai` (zai), same path | `Bearer` |
| Ychris12138/dsh-usage-stats | `inject` includes `credentials`; every adapter funnels through `resolveCredential(credentials, ref)`; refs from `llm-pi-ai`/`llm-deepseek` settings + monitor `credentialRef` | (a) hard dep, (e) `opencode/auth.json` fallback | `api.z.ai`/`open.bigmodel.cn` `/api/monitor/usage/quota/limit` **plus** `/api/biz/subscription/list` | **raw key**, no `Bearer` prefix |
| Physicolor/harness-widgets | `inject: ['webServer','credentials']`; hardcoded `OPENCODE_GO_API_KEY`; resolve inside same-origin proxy route | (a) hard dep, no config at all | — (OpenCode Go only) | `Bearer` |
| FengHuoLinShan/dsh-plugin-llm-balance | `credentials.resolve(apiKeyEnv)` for all providers except `openai-codex`; OAuth via optional `dsh-codex-connect` store for codex | (a) + (d) OAuth delegation | **none** — GLM row resolves the key then reports `no_balance_api` | `Bearer` |

Cross-cutting observations:

- **5 of 6 consume `ctx.credentials` directly**; the 6th (llm-balance) does too for
  API-key providers and only delegates OAuth to a peer package. Nobody reads
  `~/.dsh/.credentials.yaml` manually, and nobody requires the key as a config value.
- **4 of 6 (opencodego-usage, dsh-quota, usage-stats, llm-balance) discover ref names from
  the harness's own provider settings** (`llm-pi-ai.providers.<id>.apiKeyEnv`) so a key the
  user configured once for chat "just works" for quota. quota-panel instead ships a ref
  list per catalog entry and probes them all.
- Both consumption styles seen in the wild work: hard `inject: ['credentials']`
  (quota-panel, usage-stats, harness-widgets, llm-balance) vs optional
  `ctx.get('credentials')` with graceful degradation (dsh-quota, opencodego-usage).
- Request-time re-resolution is the norm (quota-panel "re-resolves per cycle"; dsh-quota
  resolves on every refresh) — matching the seam's "resolve once per operation" rule, so
  key rotation needs no plugin restart.
- Ref *names* (never values) routinely cross into client-visible surfaces — panel state,
  error toasts, RPC payloads — which the seam's design explicitly blesses.

## Implications for the MCP-client env-bridge approach

The stock `@deepseek-ai/dsh-mcp-client` config is plain strings: `env:` mappings for stdio
children, with README examples interpolating `!!js process.env.GITHUB_TOKEN` at config-load
time. MCP servers are out-of-process — they cannot call `ctx.credentials`, and the local
credentials provider deliberately never materializes the store into the process
environment (its README: "a store the Harness owns and never materializes into the
environment cannot also serve as the user's environment layer"). Hence the launch-script
env bridge: export vars before `dsh` starts so both the LLM route and the MCP child see them.

The quota plugins sidestep the whole problem by being **in-process host plugins**: they
hold a `ctx`, so they resolve refs at request time and proxy the HTTP call host-side
(quota-panel and harness-widgets even frame this as the reason their browser halves never
touch keys). The two patterns are the two sides of the seam's own rule:

1. **Config-ref + request-time resolve** (every plugin above): config/args carry the env-var
   *name*; the value is fetched per operation through the seam. Rotatable, auditable, and
   nothing secret sits in `cordis.patch.yml` or panel state.
2. **Plain string config** (mcp-client today): the value must already be in the ambient
   environment before the consumer starts — which is exactly what the env bridge does, at
   the cost of a second key-copy mechanism outside `~/.dsh/.credentials.yaml` and its
   hot-reload/watcher semantics.

Notable details worth copying or avoiding, found in the wild:

- **Avoid**: opencodego-usage's `?key=` override persisting the key to
  `~/.dsh/.ocg-state.json` in plaintext — a second unmanaged secret store, the exact thing
  the seam exists to prevent; also keys on `curl.exe` argv / URL query strings.
- **Watch for**: dsh-quota listens to `credentials/updated`, a name the seam never emits
  (`credentials/reference-updated` is real) — its change-driven refresh is dead code.
- **Copy**: Minokun's write path — the panel's key manager calls `credentials.set(ref)`
  so manual keys land in the same managed store DSH reads, with plugin-private fallback
  refs that can't break model routing; and usage-stats' single `resolveCredential()`
  choke point that keeps every adapter behind one seam call.
- **Auth is not uniform at the far end**: the Z.ai/Zhipu quota endpoint takes `Bearer`
  in four plugins but the **raw key** in usage-stats (its comment says the Coding Plan
  endpoint expects the raw key "unlike the inference API") — a reminder that the seam
  standardizes key *storage*, not upstream header shapes.
- llm-balance's optional-peer delegation (`dsh-codex-connect`) is the in-process answer to
  "the credential isn't an API key at all": wrap the OAuth/first-party-store access in a
  package that itself consumes the seam or owns its store, instead of bridging secrets
  through environment or config.

## Sources

- BeiZi6/dsh-opencodego-usage @ `main` (2026-08-14): `index.js`, `client.js`, `package.json` — github.com/BeiZi6/dsh-opencodego-usage
- Minokun/dsh-quota @ `main` (2026-08-21): `src/index.ts`, `src/controller.ts`, `src/direct.ts`, `src/http.ts`, `src/config.ts`, `src/mcp.ts` — github.com/Minokun/dsh-quota
- wenzetan/dsh-quota-panel @ `main` (2026-08-21): `src/index.ts` — github.com/wenzetan/dsh-quota-panel
- Ychris12138/dsh-usage-stats @ `main` (2026-08-22): `lib/index.js`, `lib/accounts.js`, `lib/subscriptions.js`, `lib/client.js` — github.com/Ychris12138/dsh-usage-stats
- Physicolor/harness-widgets @ `main` (2026-08-21; GitHub redirects the repo to `Physicolor/dsh-widgets`): `src/index.ts` — github.com/Physicolor/harness-widgets
- FengHuoLinShan/dsh-plugin-llm-balance @ `main` (2026-08-21): `lib/index.js`, `README.md` — github.com/FengHuoLinShan/dsh-plugin-llm-balance
- Seam reference: `@deepseek-ai/dsh-credentials` / `dsh-credentials-local` / `dsh-mcp-client` 0.1.1-rc.2 from the local harness install (`/home/jo/.npm/_npx/de4831d60afe10da/node_modules/@deepseek-ai/`).
