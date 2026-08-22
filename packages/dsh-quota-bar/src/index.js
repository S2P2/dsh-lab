/**
 * dsh-quota-bar host entry.
 *
 * Fetches GLM Coding Plan quota windows every 60s (5s timeout, last-good cache,
 * silent degrade) and serves the latest Reading to the browser half over a
 * loopback-only HTTP route, the dshmarket webServer pattern:
 *
 *   GET /dsh-quota-bar/reading -> { reading, fetchedAt, stale, error }
 *
 * Credential resolution (never leaves this process; the route response carries
 * only percentages and reset times):
 *   1. settings document: llm-pi-ai.providers.zai.{apiKeyEnv, baseUrl}
 *   2. env fallback: ZAI_API_KEY / ZAI_BASE_URL
 * Upstream: GET {base}/api/monitor/usage/quota/limit with the raw API key
 * (no Bearer prefix) — ported from pi-config's proven statusline fetcher.
 */
import { parseGlmQuota } from "./parse-glm.js";

export const name = "dsh-quota-bar";

const REFRESH_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_BASE = "https://api.z.ai";
const UPSTREAM_PATH = "/api/monitor/usage/quota/limit";

const state = {
  reading: null,
  fetchedAt: 0,
  stale: true,
  error: null,
};

/** Resolve the zai provider config from the settings service, defensively. */
function providerConfig(ctx) {
  try {
    const doc = ctx.get("settings")?.document;
    const provider = doc?.["llm-pi-ai"]?.providers?.zai;
    if (provider && typeof provider === "object") return provider;
  } catch {
    /* settings service not present on this host */
  }
  return {};
}

function resolveTarget(ctx) {
  const provider = providerConfig(ctx);
  const apiKeyEnv = typeof provider.apiKeyEnv === "string" ? provider.apiKeyEnv : "ZAI_API_KEY";
  const apiKey = process.env[apiKeyEnv] || process.env.ZAI_API_KEY || null;
  const rawBase =
    (typeof provider.baseUrl === "string" && provider.baseUrl) ||
    process.env.ZAI_BASE_URL ||
    DEFAULT_BASE;
  const base = rawBase.replace(/^(https?:\/\/[^/]+).*$/, "$1");
  return { apiKey, base };
}

async function refresh(ctx) {
  const { apiKey, base } = resolveTarget(ctx);
  if (!apiKey) {
    state.stale = true;
    state.error = `no API key: set $${resolveTarget(ctx).apiKeyEnv || "ZAI_API_KEY"} or configure llm-pi-ai.providers.zai.apiKeyEnv`;
    return;
  }
  try {
    const resp = await fetch(base + UPSTREAM_PATH, {
      headers: { Authorization: apiKey, "Accept-Language": "en-US" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`upstream HTTP ${resp.status}`);
    const reading = parseGlmQuota(await resp.json());
    if (!reading) throw new Error("unparseable upstream response");
    state.reading = reading;
    state.fetchedAt = Date.now();
    state.stale = false;
    state.error = null;
  } catch (e) {
    state.stale = true;
    state.error = String((e && e.message) || e);
  }
}

export function apply(ctx, _config) {
  refresh(ctx);
  const timer = setInterval(() => refresh(ctx), REFRESH_MS);

  ctx.inject(["webServer"], (host) => {
    host.effect(
      () =>
        host.webServer.register({
          kind: "exact",
          path: "/dsh-quota-bar/reading",
          handler: (request, response) => {
            if (request.method !== "GET") {
              response.writeHead(405, { allow: "GET" });
              response.end();
              return;
            }
            const body = JSON.stringify({
              reading: state.reading,
              fetchedAt: state.fetchedAt || null,
              stale: state.stale,
              error: state.error,
            });
            response.writeHead(200, {
              "content-type": "application/json",
              "cache-control": "no-store",
            });
            response.end(body);
          },
        }),
      "dsh-quota-bar: reading route"
    );
  });

  ctx.on("dispose", () => clearInterval(timer));
}
