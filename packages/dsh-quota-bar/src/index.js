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
 *   1. credentials service: resolve(apiKeyEnv) — layers process env over the
 *      managed store over .env (settings carry REFERENCES, not secrets)
 *   2. direct env fallback for hosts without the service
 * The zai provider config (apiKeyEnv ref name + baseUrl) comes from the
 * settings document: llm-pi-ai.providers.zai.
 *
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
let refreshing = false;

/** Resolve the zai provider config from the settings service, defensively. */
function providerConfig(ctx) {
  try {
    const doc = ctx.get("settings")?.document;
    const provider = doc?.["llm-pi-ai"]?.providers?.zai;
    if (provider && typeof provider === "object") return provider;
  } catch {
    /* settings service not present or not started */
  }
  return {};
}

async function resolveTarget(ctx) {
  const provider = providerConfig(ctx);
  const apiKeyEnv = typeof provider.apiKeyEnv === "string" ? provider.apiKeyEnv : "ZAI_API_KEY";
  let apiKey = null;

  // Resolved per fetch, never cached (credential-service doctrine), so a
  // rotated key reaches the very next refresh without a restart.
  try {
    const hit = await ctx.credentials?.resolve(apiKeyEnv);
    if (hit && typeof hit.value === "string" && hit.value) apiKey = hit.value;
  } catch {
    /* credentials service not present on this host */
  }
  // Direct env fallback for hosts without the service.
  if (!apiKey) apiKey = process.env[apiKeyEnv] || process.env.ZAI_API_KEY || null;

  const rawBase =
    (typeof provider.baseUrl === "string" && provider.baseUrl) ||
    process.env.ZAI_BASE_URL ||
    DEFAULT_BASE;
  const base = rawBase.replace(/^(https?:\/\/[^/]+).*$/, "$1");
  return { apiKey, base, apiKeyEnv };
}

async function refresh(ctx) {
  if (refreshing) return;
  refreshing = true;
  try {
    const { apiKey, base, apiKeyEnv } = await resolveTarget(ctx);
    if (!apiKey) {
      state.stale = true;
      state.error = `no API key behind ref ${apiKeyEnv} (credentials service or environment)`;
      return;
    }
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
  } finally {
    refreshing = false;
  }
}

export function apply(ctx, _config) {
  // Wait for both services before the first fetch: an eager refresh before the
  // credentials provider has started resolves nothing and poisons the cache
  // with a key-missing error until the next interval tick.
  ctx.inject(["webServer", "credentials"], (host) => {
    refresh(host);

    host.effect(() => {
      const timer = setInterval(() => refresh(host), REFRESH_MS);
      return () => clearInterval(timer);
    }, "dsh-quota-bar: poll timer");

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
            // Nudge a re-fetch when a client polls a stale/error snapshot
            // (e.g. key was just stored or the service started late); the
            // current response still serves the last-known state.
            if (state.stale) refresh(host);
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
}
