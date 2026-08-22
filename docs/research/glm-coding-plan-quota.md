# GLM Coding Plan (Z.ai / Zhipu bigmodel.cn) — quota semantics & programmatic usage query

Researched 2026-08-22 via `curl` against docs.z.ai / docs.bigmodel.cn raw-markdown pages (Mintlify `.md` suffix) and source of three tools that query coding-plan usage: [wenzetan/dsh-quota-panel](https://github.com/wenzetan/dsh-quota-panel), [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats), [farion1231/cc-switch](https://github.com/farion1231/cc-switch/blob/40d747c009bff6a6097d5094e57d205420d9b24c/src-tauri/src/services/coding_plan.rs).

## 1. Tiers and limits

**Current individual plans (credits-based, introduced 2026-07-30)** — [docs.z.ai/devpack/overview](https://docs.z.ai/devpack/overview), [docs.bigmodel.cn/cn/coding-plan/overview](https://docs.bigmodel.cn/cn/coding-plan/overview):

| Plan | $/month | 5-hour credits | Weekly credits |
|---|---|---|---|
| Lite | 18 | 2,000 | 10,000 |
| Pro | 72 | 12,000 | 60,000 |
| Max | 160 | 28,000 | 140,000 |

- **Team plans**: Standard Seat 15,000/5h + 66,000/week; Premium Seat 35,000/5h + 155,000/week ([devpack/teamplan](https://docs.z.ai/devpack/teamplan)).
- **Credit formula** (all models share one pool — no per-model caps): `(input×mult + cached_input×mult + output×mult) / 10000`. Multipliers: GLM-5.3 = 6.9/1.7/24, GLM-5-Turbo = 5.7/1.5/21, GLM-4.7 = 4.6/1.2/16, GLM-4.6V (Vision MCP) = 1.2/0.3/2.7; MCP tools (Web Search / Web Reader / Zread) = 1.2 credits per call.
- **Off-peak = 50% of the credit rate.** Peak = Mon–Fri 14:00–18:00 UTC+8 (Singapore Time); weekends are all-day off-peak on legacy plans (stated) and the same peak definition applies to new plans.
- **Models**: GLM-5.3, GLM-5-Turbo, GLM-4.7 only; calls to legacy names (GLM-5.2/5.1) auto-route to GLM-5.3. There is **no air/flash tier** in the plan — cheaper models are simply not callable.
- **Windows**: both a 5-hour and a weekly limit. 5h credits are "dynamically refreshed — quota resets **5 hours after consumption**" (rolling, not fixed clock windows); weekly credits start at purchase and reset every 7 days.
- **Concurrency**: tier-based and dynamically adjusted, "Max > Pro > Lite"; recommended concurrent projects: Lite 1, Pro 1–2, Max 2+; higher off-peak. **No exact RPM/parallel-request numbers are documented** ([devpack/usage-policy](https://docs.z.ai/devpack/usage-policy)).
- Z.ai publishes estimated weekly token ranges by cache-hit rate (e.g. Lite 43–105M tokens/week on GLM-5.3; Max up to 1,463M).
- **Legacy plans** (pre-2026-07-30, prompts-based, still active for existing subscribers): Lite ~80 prompts/5h + ~400/week; Pro ~400/5h + ~2,000/week; Max ~1,600/5h + ~8,000/week; 1 prompt ≈ 15–20 model calls; ≈15–30× subscription fee at API prices ([usage-revision notice](https://docs.z.ai/devpack/notice/usage-revision)).

## 2. Programmatic quota endpoint — yes, but undocumented

No quota API appears in the official docs/sitemap; dashboards ([z.ai/manage-apikey/subscription](https://z.ai/manage-apikey/subscription), [bigmodel.cn/coding-plan/personal/usage](https://www.bigmodel.cn/coding-plan/personal/usage)) are the documented surface. The endpoint those consoles use, confirmed independently in three codebases:

```
GET https://api.z.ai/api/monitor/usage/quota/limit            # global (z.ai)
GET https://open.bigmodel.cn/api/monitor/usage/quota/limit    # China (bigmodel.cn)
Authorization: <raw API key>          # NO "Bearer" prefix (cc-switch, dsh-usage-stats)
```

- dsh-quota-panel sends `Authorization: Bearer <key>` instead — whether Bearer is also accepted is **UNVERIFIED** (no key available to test). Two of three implementations use the raw key; dsh-usage-stats comments "the Coding Plan endpoint expects the raw API key, unlike the inference API".
- Response shape (from dsh-quota-panel README + parsers in all three tools):

```json
{ "code": 200, "data": { "level": "PRO", "limits": [
  { "type": "TOKENS_LIMIT", "unit": 3, "number": 5,
    "percentage": 42, "currentValue": 840, "usage": 2000,
    "remaining": 1160, "nextResetTime": 1761234567890 },
  { "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 17, ... },
  { "type": "TIME_LIMIT", ... } ] } }
```

  - `percentage` = **used** percent; `usage` = window total, `currentValue` = used, `remaining` = left; `nextResetTime` = epoch ms.
  - Window semantics: `TOKENS_LIMIT` with `unit=3, number=5` → 5-hour window; `unit=6` → weekly (`number` observed as both 7 and 1); `TIME_LIMIT` → monthly MCP-tool lane. `unit` encoding: 3=hours, 6=weeks, 1=days, 5=minutes (dsh-usage-stats `zaiWindowMinutes`).
  - `data.level` / `planName` / `plan_type` carries the tier label.
- **Team-plan variant** (cc-switch, crediting `token-monitor`): same path with `?type=2` plus required headers `bigmodel-organization: <org>` and `bigmodel-project: <project>`, on open.bigmodel.cn.
- Companion endpoint `GET /api/biz/subscription/list` (same auth) returns `data[0].product_name` / `next_renew_time` (dsh-usage-stats).
- Plan without a key returns HTTP 401/403 → treat key as invalid (cc-switch).

## 3. How plugins meter usage locally (no-endpoint fallback)

dsh-usage-stats additionally aggregates **DSH session event logs** — usage samples riding `assistant/chunk` (`data.chunk.type === "usage"`) and `assistant/message` (`data.usage`), deduplicated per `(turn, step)` (a repeat replaces, not double-counts), bucketed input/output/cacheRead/cacheWrite per day and per model (`lib/usage.js`). This yields absolute token counts (the endpoint only gives percentages/windows). dsh-quota-panel does no local metering; it polls the endpoint above.

## 4. Quirks

- **Reset timing**: 5h window is rolling ("resets 5 hours after consumption"), weekly is anchored to purchase instant — both independent of calendar midnight. Peak-hour math and all notice dates use **UTC+8 (Singapore)**. cc-switch issue #3036: near week-end the weekly window can reset *earlier* than the 5h one — classify by `unit`, never by `nextResetTime` ordering.
- **Old vs new plans**: subscriptions before 2026-02-12 return a single `TOKENS_LIMIT` row (5h only); newer plans return two (cc-switch). Legacy V1/V2 keep prompt-based limits until their billing cycle ends; V2 may upgrade to the credits plan mid-cycle, V1 must wait for expiry.
- **Shared pool**: one quota across all three models, all MCP tools, and all supported coding tools ("All supported coding tools share the same usage quota").
- **On exhaustion**: calls fail until the next 5h/weekly reset; the system explicitly does **not** fall back to account balance ("1113 Insufficient Balance" is the error users see when *misconfigured* — wrong base URL or unsupported tool). Exact HTTP status for genuine quota exhaustion is **UNVERIFIED** (docs don't state it; plugins don't special-case it). Team seats: model unusable until reset unless the admin enables paid overage (billed at API list −10%).
- **Required base URLs**: `https://api.z.ai/api/anthropic` (Claude Code, Goose) / `https://api.z.ai/api/coding/paas/v4` (other tools); plan quota only applies within officially supported tools — use elsewhere can trigger risk control (rate-limit, freeze; >3 violations → ban).
- **Promo/expiry**: subscriptions non-refundable; auto-renew charge order = platform credits → cash balance → payment method. Cancellation deadlines conflict across pages: ≥24h before billing (FAQ, subscription-terms) vs ≥3 days (usage-policy). Referral credits are non-withdrawable; 50% "migration support" discount valid until 3 months after legacy-plan expiry; same-tier upgrades stack validity, cross-tier upgrades take effect immediately with pro-rata remainder as account balance.
