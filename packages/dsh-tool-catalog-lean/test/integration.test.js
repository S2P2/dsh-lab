/**
 * Integration through the public seam: the `system-prompt/assemble`
 * waterfall. Mounts of the same plugin entry:
 *
 * 1. Always: a faithful replica of the cordis waterfall composition
 *    (outermost-first in registration order, `next` chaining, innermost
 *    fallback), driving the listener registered by `apply()`. When no
 *    real `@deepseek-ai/cordis` resolves, this is the fallback — and it
 *    says so, never passing as if the real seam ran.
 * 2. When a real `@deepseek-ai/cordis` is importable (see helpers), the
 *    same plugin mounted on a real `Context` and driven with the exact
 *    `ctx.waterfall("system-prompt/assemble", assembly, context, ...)`
 *    call shape `dsh-system-prompt` makes.
 * 3. When a real `@deepseek-ai/dsh-system-prompt` is importable too, the
 *    spec's Testing Decisions shape: a real `SystemPrompt` service with
 *    a fake tool provider (fixture subset: bash + one unknown tool), the
 *    plugin loaded on the same context, and the projection asserted on
 *    what `ctx.systemPrompt.assemble()` actually delivers.
 *
 * In every mount the "fake tool provider" is the captured stock catalog
 * (or a subset): assembly.tools starts as the host assembled it, and the
 * delivered tools must carry shortened descriptions with structure
 * preserved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { apply, name } from "../src/index.js";
import { descriptionMap } from "../src/map.js";
import {
  loadStockTools,
  stripDescriptions,
  composeWaterfall,
  loadRealCordis,
  loadRealSystemPrompt,
} from "./helpers.js";

function freshAssembly() {
  // Mirrors the assembly object dsh-system-prompt hands the waterfall.
  // One fixture parse feeds both the assembly and the reference checks.
  return {
    sections: [{ name: "persona", text: "You are an agent." }],
    contexts: [],
    tools: loadStockTools(),
    variables: {},
  };
}

function captureListener() {
  const registered = [];
  const ctx = {
    on: (event, listener) => {
      registered.push({ event, listener });
      return () => registered.splice(registered.indexOf(listener), 1);
    },
  };
  return { ctx, registered };
}

test("plugin entry registers exactly one system-prompt/assemble listener", () => {
  const { ctx, registered } = captureListener();
  apply(ctx);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].event, "system-prompt/assemble");
});

test("seam (replica waterfall): delivered tools carry shortened descriptions, structure preserved", async () => {
  // Visible degradation: when this replica is the fallback, say so
  // instead of passing as if the real seam ran.
  const real = await loadRealCordis();
  if (!real) {
    console.log(
      "tool-catalog-lean integration: no real @deepseek-ai/cordis resolvable " +
        "(env DSH_TEST_CORDIS_ENTRY, checkout resolution, or ~/.npm/_npx/*) — " +
        "running the replica waterfall; real-seam assertions are skipped below",
    );
  }

  const { ctx, registered } = captureListener();
  apply(ctx);

  const assembly = freshAssembly();
  const stockBash = assembly.tools.find((tool) => tool.name === "bash");
  const context = { session: "test" };
  let observedByInnerListener = null;

  const delivered = await composeWaterfall(
    registered.map((entry) => entry.listener),
    [assembly, context],
    () => {
      // An inner listener (registered later = runs after the plugin) sees
      // the already-rewritten tools, proving outermost-first chaining.
      observedByInnerListener = assembly.tools.find((tool) => tool.name === "bash");
      return Promise.resolve(assembly);
    },
  );

  assert.equal(delivered, assembly, "waterfall returns the assembly");
  const deliveredBash = delivered.tools.find((tool) => tool.name === "bash");
  assert.ok(deliveredBash.description.length < stockBash.description.length);
  assert.ok(observedByInnerListener.description.length < stockBash.description.length);
  assert.deepEqual(stripDescriptions(delivered.tools), stripDescriptions(assembly.tools));
  for (const tool of delivered.tools) {
    if (tool.name === "bash") continue;
    assert.strictEqual(tool, assembly.tools.find((entry) => entry.name === tool.name));
  }
});

test("seam (real cordis waterfall): same assertions through the installed @deepseek-ai/cordis", async (t) => {
  const cordis = await loadRealCordis();
  if (!cordis) {
    t.skip("no importable @deepseek-ai/cordis found; replica waterfall test above covers the contract");
    return;
  }

  const ctx = new cordis.Context({});
  apply(ctx);
  assert.equal(name, "dsh-tool-catalog-lean");

  const stock = loadStockTools();
  const assembly = {
    sections: [],
    contexts: [],
    tools: stock,
    variables: {},
  };
  const stockBash = stock.find((tool) => tool.name === "bash");
  const context = {};

  // The exact call shape dsh-system-prompt makes (lib/index.js):
  //   await ctx.waterfall("system-prompt/assemble", assembly, context, () => Promise.resolve(assembly))
  const delivered = await ctx.waterfall("system-prompt/assemble", assembly, context, () =>
    Promise.resolve(assembly),
  );

  const deliveredBash = delivered.tools.find((tool) => tool.name === "bash");
  assert.ok(deliveredBash.description.length < stockBash.description.length);
  assert.ok(deliveredBash.description.includes("[exit code: N]"));
  assert.deepEqual(stripDescriptions(delivered.tools), stripDescriptions(stock));
  // Every tool is curated in the full map, so per-tool the check is
  // structure-only: descriptions may differ, nothing else may.
  for (const tool of delivered.tools) {
    const original = stock.find((entry) => entry.name === tool.name);
    assert.deepEqual(stripDescriptions(tool), stripDescriptions(original));
  }
});

test("composition (real dsh-system-prompt): fake tool provider + plugin through ctx.systemPrompt.assemble()", async (t) => {
  const cordis = await loadRealCordis();
  const systemPrompt = await loadRealSystemPrompt();
  if (!cordis || !systemPrompt) {
    t.skip(
      `no ${!cordis ? "@deepseek-ai/cordis" : "@deepseek-ai/dsh-system-prompt"} resolvable; ` +
        "the waterfall-level tests above remain the composition fallback",
    );
    return;
  }

  const ctx = new cordis.Context({});
  ctx.plugin(systemPrompt.SystemPrompt, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
  });
  // The service lands on the context after the plugin fiber schedules —
  // poll briefly rather than assume a fixed tick count.
  const deadline = Date.now() + 2000;
  while (ctx.systemPrompt === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(ctx.systemPrompt, "systemPrompt service became available");

  // Fake tool provider: fixture subset with bash (curated, deep parameters
  // tree), ask_user_question (curated, object-form items), and one unknown
  // MCP-shaped tool — what the spec's Testing Decisions call a minimal
  // composition. The provider returns fresh clones, like the real host.
  const stock = loadStockTools();
  const subset = [
    stock.find((tool) => tool.name === "bash"),
    stock.find((tool) => tool.name === "ask_user_question"),
    { name: "mcp__acme__widget", description: "An unknown MCP tool.", parameters: { type: "object" } },
  ];
  const stockBash = stock.find((tool) => tool.name === "bash");
  ctx.systemPrompt.tools(() => ({ schemas: structuredClone(subset) }));

  apply(ctx); // the plugin under review, on the same real context

  const delivered = await ctx.systemPrompt.assemble();

  // Canonical assembly sorts tools by name: ask_user_question, bash, mcp__…
  assert.deepEqual(
    delivered.tools.map((tool) => tool.name),
    subset.map((tool) => tool.name).sort(),
  );

  // Curated tool-level description landed, shortened, facts intact.
  const deliveredBash = delivered.tools.find((tool) => tool.name === "bash");
  assert.ok(deliveredBash.description.length < stockBash.description.length);
  assert.ok(deliveredBash.description.includes("[exit code: N]"));

  // Curated nested (object-form items) description landed verbatim — the
  // curated `options` string is shorthand for that node's description.
  const ask = delivered.tools.find((tool) => tool.name === "ask_user_question");
  assert.equal(
    ask.parameters.properties.questions.items.properties.options.description,
    descriptionMap.ask_user_question.parameters.properties.questions.items.properties.options,
  );

  // Unknown tool passes through byte-identical to what the provider gave.
  const unknown = delivered.tools.find((tool) => tool.name === "mcp__acme__widget");
  assert.deepEqual(unknown, {
    name: "mcp__acme__widget",
    description: "An unknown MCP tool.",
    parameters: { type: "object" },
  });

  // Structure preserved across the whole delivered set: stripping every
  // description from delivered and provider tools is deep-equal.
  const byName = (a, b) => (a.name < b.name ? -1 : 1);
  assert.deepEqual(stripDescriptions(delivered.tools), stripDescriptions([...subset].sort(byName)));
});
