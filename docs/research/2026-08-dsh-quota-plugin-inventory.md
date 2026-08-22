# DSH quota/cost plugin inventory (5 repos)

Researched 2026-08-22 from primary sources: README + host/client source fetched via raw.githubusercontent.com (no installs). All five are **dual-face DSH web plugins**: a Node host half (`exports "."`) + browser half (`exports "./client"`, `dsh.client` manifest), inserted into the web profile by `cordis.patch.yml`. Credentials are resolved host-side; browsers only see loopback RPC/HTTP.

## 1. wenzetan/dsh-quota-panel (v0.8.x, TS, zero-dep)

Multi-provider floating quota card. Host half auto-discovers ~14 providers by probing standard credential refs (`ctx.credentials`), fetches balance/usage upstream, normalizes to `balance`/`usage`/`info` view models; browser half renders a collapsed capsule (status dot + battery value per account) expanding to a 300px card + ⚙ settings panel. zh/en i18n via `ctx.locale`; `dsh-plugin-check`-clean.

- **Data sources** (host-side GET, `Authorization: Bearer`, optional per-row HTTP proxy): `api.deepseek.com/user/balance`; `openrouter.ai/api/v1/credits`; `api.siliconflow.com|.cn/v1/user/info`; `api.moonshot.cn/v1/users/me/balance`; `www.minimax.io`/`api.minimaxi.com/v1/token_plan/remains`; `api.stepfun.com/v1/accounts`; `api.x.ai/v1/billing/credits`; `open.bigmodel.cn` & `api.z.ai/api/monitor/usage/quota/limit`; `api.kimi.com/coding/v1/usages`; `opencode.ai/zen/go/v1/usage`; Volcengine Ark via HMAC-signed AK/SK (`open.volcengineapi.com`). No local metering.
- **GLM/Z.ai**: three catalog rows — `zhipu` (`ZHIPU_API_KEY`/`GLM_API_KEY`, `zhipu-quota` info format), `zai-coding-cn` (`ZAI_CODING_CN_API_KEY` → bigmodel.cn), `zai` (`ZAI_API_KEY` → z.ai), both `zai-coding-quota`. Semantics (cross-checked vs console + glm-plan-usage2): `TOKENS_LIMIT unit=3` = 5h rolling window, `unit=6` = weekly, `TIME_LIMIT` = monthly MCP lane; separate search lane; % from `percentage` or `currentValue/usage`; no fabricated 0% (`-%` when unknown).
- **UI**: `shell.overlay` slot, React, design tokens (`--dsw-*`); loopback Connection RPC channel `/dsh-quota-panel` with `specs` (render hints only) + `fetch-all` (normalized views; raw JSON stays host-side). Overlay-layer z-index lift for body-mounted third-party UI.
- **Config**: `refreshMs`, `auto` (discovery on/off), `hide`, `proxies`, `catalog` per-id overrides (label/endpoint/format/proxy/refs/currency/balanceTiers/warnPercent/errorPercent/windowLabels), explicit `providers:` rows (incl. `openai-billing` format for one-api/new-api). Settings panel persists to localStorage and overrides profile.
- **Standouts**: credential-probe auto-discovery (zero-config onboarding); normalized 3 view models; refreshingly honest proxy security writeup (Authorization leaks to proxy; unauthenticated loopback RPC can redirect keys anywhere). **Gaps**: no local token metering/cost, no prompt-side alerts, no blocking, one account per provider.

## 2. ai-shushu/dsh-quota-meter (v0.5.0)

Per-session **money** quota with enforcement: bills every `llm/stream` usage chunk (inputTokens / cacheRead+cacheWrite / outputTokens) × editable per-model price table (DeepSeek peak/off-peak), shows a 2px progress bar above the input, and **blocks new model calls** via `agent/pre-step` when the session quota is exhausted.

- **Data sources**: purely local usage-chunk metering; official price sync scrapes `https://api-docs.deepseek.com/zh-cn/quick_start/pricing` (host caches 60s, diff → manual confirm before writing). No provider quota APIs.
- **GLM/Z.ai**: none — no coding-plan/balance endpoints; GLM models could be *priced* in the table but no quota query.
- **UI**: `conversation.input.dock` slot (thin bar, right-aligned shrink, "burn" pulse on request, `-¥` badge on deduction) + `shell.overlay` (exhaustion modal); client polls host `/quota/state` (ctx.webServer) at 1s.
- **Config**: per-session quota; per-model price table with time-of-day peak windows (custom timezone + hours per model); `fallback` price; ignore/plan model lists; ledger at `~/.dsh/storages/quota-meter-shushu/` (survives restart, cleaned with session).
- **Standouts**: only plugin that **enforces** budgets; subagent spend rolls up to root parent session; auxiliary calls (title gen, compaction) billed; price sync never silently overwrites manual edits. **Gaps**: DeepSeek/¥-centric, no balances/subscriptions, no history analytics, single currency.

## 3. GLFzr/dsh-opencode-go-quota (v0.3.2)

Single-purpose OpenCode Go quota ring (22px, beside the model selector): click cycles 5h / weekly / monthly windows; color tiers green/blue/orange/red; ≥80% red pulse; hover shows reset countdown. Also injects tiered quota warnings into the **system prompt** (Codex-CLI style): nothing below `warnAt`, one announcement per tier, escalating every 2% from 90%.

- **Data sources**: `GET https://opencode.ai/zen/go/v1/usage` (Bearer). Key from `OPENCODE_GO_API_KEY` env or `~/.local/share/opencode/auth.json` (BOM-tolerant), read via a `node -` child through `ctx.shell` (Windows ACL sandbox caveat documented).
- **GLM/Z.ai**: none (OpenCode Go only). Semantics: 5h rolling + weekly + monthly %, reset times.
- **UI**: `conversation.input.right` slot ring; host route `/ocg-quota/usage` (cacheTtl-throttled, errors cached 5s, response carries thresholds); `inject: ['webServer','shell','systemPrompt']`.
- **Config** (cordis.yml): `warnAt`/`criticalAt`/`escalateFrom`/`escalateStep` (60/80/90/2), `cacheTtl` (60s), `errorCacheTtl` (5s), `weeklyWarnAt`/`monthlyWarnAt` (90/95).
- **Standouts**: once-per-tier prompt injection keeps the prefix stable (cache-friendly, zero prompt cost when healthy) — the best agent-awareness idea here; graceful gray-`!` degradation with error tooltip. **Gaps**: one provider, one account, no cost metering, needs host subprocess.

## 4. Ychris12138/dsh-usage-stats (v0.2.9)

Sidebar "Usage/Balance" panel combining account cards (API balance vs subscription windows) with token-usage analytics: today/month/all-time, cache-hit rate, calendar heatmap, drill-downs by date/provider/model — folded **incrementally from local session event logs** (pure functions, cordis-free, unit-tested). Server refreshes every 5 min; browser fetches only the selected provider.

- **Data sources**: (a) local: session event-log folds (`lib/usage.js`); (b) subscriptions: `opencode.ai/zen/go/v1/usage` (+ cookie-scraped dashboard `/workspace/<id>/go` fallback), `api.z.ai`/`open.bigmodel.cn` + `/api/monitor/usage/quota/limit` and `/api/biz/subscription/list`, `api.kimi.com/coding/v1/usages`, minimax `.io`/`minimaxi.com` `/v1/token_plan/remains` + `/v1/api/openplatform/coding_plan/remains`; (c) balances: DeepSeek, New API, Sub2API (`/user/balance`, `/api/v1/usage/stats?period=today`, `/api/v1/settings/public` probe), plus **declarative JSON-Pointer** custom queries (no executable JS). Providers auto-discovered from official DeepSeek routes and `llm-pi-ai` profiles; 5 loopback GET endpoints only.
- **GLM/Z.ai**: `zai-token-plan` adapter; region from `ZAI_API_REGION` (global vs bigmodel-cn); window minutes computed from limit `unit` (3=hours, 6=weeks, 1=days, 5=raw minutes) → 5h + weekly semantics; used% from `usage`/`remaining`/`currentValue` or `percentage`; plan display name from subscription list.
- **UI**: `sidebar.footer.action` entry + settings sections; React panel with provider switcher.
- **Config**: declarative monitor templates (JSON Pointer + `warnBelow`/`criticalBelow`), region envs, opencode cookie/workspace refs; ships DSH Community Market catalog manifests (`catalog-source.json`, `catalog/v1/plugins.json`) + idempotent `npx` installer.
- **Standouts**: JSON-Pointer declarative extraction (eval-free extensibility); incremental log fold; subscription/list for human plan names; market-catalog distribution; SECURITY.md. **Gaps**: tokens only — no pricing/cost, no budget alerts or blocking, one provider visible at a time.

## 5. Han-1413141/dsh-cost-meter (v1.5.36, default branch `master`)

Kitchen-sink cost & quota monitor: per-session cost badge (input area or title bar), daily/monthly/all-time totals, budget box, official DeepSeek balance (3-segment bar), configurable custom-provider balance, 8 coding-plan quota cards, peak/off-peak pricing display with pre-switch popup + system notifications, Codex-style 26-week usage heatmap, and log-replay backfill reconstructing per-model and pre-install history. Bilingual zh/en.

- **Data sources**: local metering wraps `llm/stream` usage blocks, priced at **event time** (peak/off-peak, with a 2026-08-16 historical-rate cutover); `GET {baseURL}/user/balance` (DeepSeek only, key never sent to non-official domains); coding plans via hardcoded endpoint whitelist with region fallback (`CODING_PLAN_ENDPOINTS`): Anthropic `/api/oauth/usage`; **Z.ai**: `open.bigmodel.cn` & `api.z.ai/api/monitor/usage/quota/limit` then v3/v4 `/api/coding/paas/{v3,v4}/dashboard/billing/coding_plan/usage`; MiniMax ×3; Kimi moonshot balance; OpenRouter credits; SiliconFlow user/info; CommandCode `/alpha/billing/credits`; SCNet = local credits estimate (no API exists); OpenCode `zen/go/v1/usage`; price sync scrapes `https://api-docs.deepseek.com/quick_start/pricing` (Docusaurus HTML); custom balance = user URL/headers with `{{ENV}}` placeholders + `extract` rules (const / dot-path / add/subtract / **divide** for NewApi quota units, 1 USD = 500000).
- **GLM/Z.ai**: `parseZaiUsage` accepts 3 response shapes: monitor `data.limits` (`TOKENS_LIMIT unit 3`=5h, `unit 6`=weekly, `TIME_LIMIT` monthly MCP excluded), legacy `plans[]` (reset span >1 day ⇒ weekly else 5h), and `{five_hour, weekly}`; on 401 it tries the other domain (bigmodel.cn ↔ z.ai keys are not interchangeable); envs `ZAI_API_KEY`/`BIGMODEL_API_KEY`.
- **UI**: `costUsage` session projection read via `useProjection('costUsage')` (client-side pricing); `costMeter` service over the Typert gateway (`remote.costMeter.getState|updateConfig|fetchPrices|refreshBalance|resetHistory`); slots: `conversation.composer.dock`, `conversation.session.header.actions`, `sidebar.footer.action` (boxes + rail mode), `settings.section`/`settings.general.item`, bottom-right dock chips.
- **Config**: budget (amount + period: today/month/all/custom range), per-model peak/off-peak price table, 90+-model extended catalog with fuzzy model-id matching, `historyDays` (180), display currency rate (1 USD = 7.2 CNY), custom-balance endpoints, per-plan enable/key/position/refresh, peak-alert position/lead/type + notifications, language.
- **Standouts**: log-replay backfill (zstd frame scan) rebuilding history pre-dating the plugin; per-event-time historical pricing; Typert manifest RPC; Z.ai domain-fallback; NewApi `divide` extract. **Gaps**: monolithic 5k-line client bundle; quota is advisory only (no blocking); DeepSeek-centric pricing, manual catalogs elsewhere; overwhelming README.

## Cross-cutting takeaways for dsh-quota-bar

- **Quota semantics everyone converged on** for GLM coding plans: `monitor/usage/quota/limit` with `TOKENS_LIMIT unit=3` ≈ 5h rolling, `unit=6` ≈ weekly, `TIME_LIMIT` ≈ monthly MCP/search lane; bigmodel.cn ↔ z.ai keys don't interchange — probe both domains.
- Best per-repo ideas worth stealing: quota-panel's credential-probe auto-discovery + normalized view models; quota-meter's `agent/pre-step` budget blocking + subagent rollup; ocg-quota's once-per-tier system-prompt injection; usage-stats' JSON-Pointer declarative adapters + incremental log fold; cost-meter's event-time pricing + log-replay backfill.
- No single repo combines provider quota APIs, local cost metering, prompt-tier warnings, *and* enforcement — that's the open design space for `packages/dsh-quota-bar`.
