import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGlmQuota } from "../src/parse-glm.js";

/** Response shape triangulated from dsh-quota-panel, dsh-usage-stats, cc-switch
 * (docs/research/glm-coding-plan-quota.md) and pi-config's fetcher. */
const fullResponse = {
  code: 200,
  data: {
    level: "GLM Coding Plan - Pro",
    limits: [
      {
        type: "TOKENS_LIMIT",
        unit: 3,
        percentage: 42.7,
        usage: 5100,
        currentValue: 5100,
        remaining: 6900,
        nextResetTime: 1755900000000,
      },
      {
        type: "TOKENS_LIMIT",
        unit: 6,
        percentage: 71.2,
        usage: 42000,
        currentValue: 42000,
        remaining: 18000,
        nextResetTime: 1756388400000,
      },
      {
        type: "TIME_LIMIT",
        unit: 5,
        percentage: 12,
        usage: 30,
        currentValue: 30,
        remaining: 220,
        nextResetTime: 1756560000000,
      },
    ],
  },
};

test("full three-window response parses into fiveHour/weekly/tools", () => {
  const r = parseGlmQuota(fullResponse);
  assert.deepEqual(r.fiveHour, { pct: 42, resetAt: 1755900000000 });
  assert.deepEqual(r.weekly, { pct: 71, resetAt: 1756388400000 });
  assert.deepEqual(r.tools, { pct: 12, resetAt: 1756560000000 });
  assert.equal(r.plan, "GLM Coding Plan - Pro");
});

test("percentages floor, never round", () => {
  const r = parseGlmQuota(fullResponse);
  assert.equal(r.fiveHour.pct, 42); // 42.7 -> 42
  assert.equal(r.weekly.pct, 71); // 71.2 -> 71
});

test("windows classify by type+unit, not reset-time order", () => {
  // Weekly reset EARLIER than the 5h window (legal near week-end; cc-switch #3036).
  // Order in the array is also inverted; classification must not care.
  const swapped = structuredClone(fullResponse);
  swapped.data.limits = [swapped.data.limits[1], swapped.data.limits[0], swapped.data.limits[2]];
  swapped.data.limits[0].nextResetTime = 1;
  swapped.data.limits[1].nextResetTime = 2;
  const r = parseGlmQuota(swapped);
  assert.equal(r.weekly.resetAt, 1); // TOKENS_LIMIT/6 stays weekly
  assert.equal(r.fiveHour.resetAt, 2); // TOKENS_LIMIT/3 stays 5h
});

test("old plans with a single TOKENS_LIMIT row parse with nulls elsewhere", () => {
  const r = parseGlmQuota({
    data: {
      limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: 60, nextResetTime: 1755900000000 }],
    },
  });
  assert.deepEqual(r.fiveHour, { pct: 60, resetAt: 1755900000000 });
  assert.equal(r.weekly, null);
  assert.equal(r.tools, null);
  assert.equal(r.plan, null);
});

test("missing nextResetTime keeps the window with resetAt null", () => {
  const r = parseGlmQuota({
    data: { limits: [{ type: "TIME_LIMIT", unit: 5, percentage: 5 }] },
  });
  assert.deepEqual(r.tools, { pct: 5, resetAt: null });
});

test("non-numeric percentage yields pct null but keeps resetAt", () => {
  const r = parseGlmQuota({
    data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: "high", nextResetTime: 123 }] },
  });
  assert.deepEqual(r.fiveHour, { pct: null, resetAt: 123 });
});

test("degenerate inputs return null, never throw", () => {
  for (const bad of [
    null,
    undefined,
    {},
    { data: null },
    { data: {} },
    { data: { limits: null } },
    { data: { limits: [] } },
    { data: { limits: "no" } },
    { data: { limits: [{ type: "UNKNOWN_LIMIT", unit: 9, percentage: 1 }] } },
    { data: { limits: [{ type: "TOKENS_LIMIT", unit: 3 }] } }, // no usable fields
  ]) {
    assert.equal(parseGlmQuota(bad), null, JSON.stringify(bad));
  }
});

test("extra unknown limit rows are ignored", () => {
  const r = parseGlmQuota({
    data: {
      limits: [
        { type: "TOKENS_LIMIT", unit: 3, percentage: 10, nextResetTime: 1 },
        { type: "MYSTERY", unit: 42, percentage: 99 },
        { type: "TOKENS_LIMIT", unit: 6, percentage: 20, nextResetTime: 2 },
      ],
    },
  });
  assert.equal(r.fiveHour.pct, 10);
  assert.equal(r.weekly.pct, 20);
  assert.equal(r.tools, null);
});
