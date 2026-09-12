/**
 * Integration through the public seam: the `system-prompt/assemble`
 * waterfall. Two mounts of the same plugin entry:
 *
 * 1. Always: a faithful replica of the cordis waterfall composition
 *    (outermost-first in registration order, `next` chaining, innermost
 *    fallback), driving the listener registered by `apply()`.
 * 2. When a real `@deepseek-ai/cordis` is importable (see helpers), the
 *    same plugin mounted on a real `Context` and driven with the exact
 *    `ctx.waterfall("system-prompt/assemble", assembly, context, ...)`
 *    call shape `dsh-system-prompt` makes.
 *
 * In both mounts the "fake tool provider" is the captured stock catalog:
 * assembly.tools starts as the host assembled it, and the delivered tools
 * must carry the shortened bash description with structure preserved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { apply, name } from "../src/index.js";
import { loadStockTools, stripDescriptions, composeWaterfall, loadRealCordis } from "./helpers.js";

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
  for (const tool of delivered.tools) {
    if (tool.name === "bash") continue;
    assert.strictEqual(tool, stock.find((entry) => entry.name === tool.name));
  }
});
