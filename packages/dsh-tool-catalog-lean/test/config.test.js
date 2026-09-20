/**
 * Config-surface tests (#81 of spec #77): enabled flag, description
 * overrides map, diagnostics flag — exercised end to end through the
 * public `apply(ctx, config)` + `system-prompt/assemble` listener, never
 * through internal helpers.
 *
 * The waterfall replica mirrors cordis composition semantics exactly as
 * `test/integration.test.js` drives them; the logger is a stub `ctx.logger`
 * capturing `info` lines.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/index.js";
import { loadStockTools, stripDescriptions, composeWaterfall } from "./helpers.js";

/** Stub ctx capturing registered listeners and logger.info lines. */
function capturePlugin() {
  const registered = [];
  const lines = [];
  const ctx = {
    on: (event, listener) => {
      registered.push({ event, listener });
      return () => registered.splice(registered.indexOf(listener), 1);
    },
    logger: { info: (line) => lines.push(line) },
  };
  return { ctx, registered, lines };
}

/** A synthetic tool no curated map will ever claim. */
function presetWidgetTool() {
  return {
    name: "preset_widget",
    description: "A preset-only tool whose stock description is wordier than needed.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", description: "The mode to run in.", enum: ["fast", "slow"] },
        opts: {
          type: "object",
          description: "Nested options.",
          properties: { deep: { type: "string", description: "Deep option." } },
        },
        count: { type: "number" },
      },
      required: ["mode"],
    },
  };
}

function freshAssembly(extraTools = []) {
  return {
    sections: [],
    contexts: [],
    tools: [...loadStockTools(), ...extraTools],
    variables: {},
  };
}

async function assemble(registered, assembly) {
  return composeWaterfall(
    registered.map((entry) => entry.listener),
    [assembly, {}],
    () => Promise.resolve(assembly),
  );
}

const bashOverride = {
  bash: {
    description: "Custom preset wording for bash.",
    parameters: {
      properties: {
        timeoutMs: "Custom timeout wording.",
      },
    },
  },
};

const widgetOverride = {
  preset_widget: {
    description: "Widget, briefly.",
    parameters: {
      properties: {
        mode: "Which mode.",
        opts: { description: "Nested options, shorter." },
      },
    },
  },
};

test("default config: enabled with no config object at all, no diagnostics", async () => {
  const { ctx, registered, lines } = capturePlugin();
  apply(ctx); // row present, no `config:` key
  assert.equal(registered.length, 1);
  assert.equal(registered[0].event, "system-prompt/assemble");

  const stock = loadStockTools();
  const stockBash = stock.find((tool) => tool.name === "bash");
  const delivered = await assemble(registered, freshAssembly());
  const deliveredBash = delivered.tools.find((tool) => tool.name === "bash");
  assert.ok(deliveredBash.description.length < stockBash.description.length);
  assert.equal(lines.length, 0, "diagnostics default to off");
});

test("enabled: false registers no listener; delivered catalog keeps identical references", async () => {
  const { ctx, registered, lines } = capturePlugin();
  apply(ctx, { enabled: false, diagnostics: true });
  assert.equal(registered.length, 0, "disabled registers nothing at all");
  assert.equal(lines.length, 0, "disabled stays silent even with diagnostics: true");

  const stock = loadStockTools();
  // The assembly carries this exact array instance, so identical-reference
  // comparison proves byte-identical stock delivery.
  const assembly = { sections: [], contexts: [], tools: stock, variables: {} };
  const delivered = await assemble(registered, assembly);
  assert.strictEqual(delivered.tools, stock);
  assert.equal(delivered.tools.length, stock.length);
  for (let i = 0; i < stock.length; i += 1) {
    assert.strictEqual(delivered.tools[i], stock[i], stock[i].name);
  }
  assert.equal(JSON.stringify(delivered.tools), JSON.stringify(stock));
});

test("defensive config: null config and non-object overrides degrade to defaults", async () => {
  const withNull = capturePlugin();
  apply(withNull.ctx, null);
  assert.equal(withNull.registered.length, 1, "null config still means enabled");

  const withBadOverrides = capturePlugin();
  apply(withBadOverrides.ctx, { overrides: "nonsense" });
  assert.equal(withBadOverrides.registered.length, 1);

  const stockBash = loadStockTools().find((tool) => tool.name === "bash");
  const delivered = await assemble(withBadOverrides.registered, freshAssembly());
  const deliveredBash = delivered.tools.find((tool) => tool.name === "bash");
  assert.notEqual(deliveredBash.description, stockBash.description, "curated map still applies");
});

test("override replaces a curated entry: the custom bash entry wins wholesale", async () => {
  const { ctx, registered } = capturePlugin();
  apply(ctx, { overrides: bashOverride });

  const stock = loadStockTools();
  const stockBash = stock.find((tool) => tool.name === "bash");
  const delivered = await assemble(registered, freshAssembly());
  const deliveredBash = delivered.tools.find((tool) => tool.name === "bash");

  assert.equal(deliveredBash.description, "Custom preset wording for bash.");
  assert.equal(
    deliveredBash.parameters.properties.timeoutMs.description,
    "Custom timeout wording.",
  );
  // v1 semantics are whole-entry replacement, not per-property merge: the
  // override entry has no `run_in_background` key, so that property keeps
  // its STOCK description — the curated short form does not leak through.
  assert.equal(
    deliveredBash.parameters.properties.run_in_background.description,
    stockBash.parameters.properties.run_in_background.description,
  );
});

test("override adds a brand-new tool name and is applied to it", async () => {
  const { ctx, registered } = capturePlugin();
  apply(ctx, { overrides: widgetOverride });

  const delivered = await assemble(registered, freshAssembly([presetWidgetTool()]));
  const widget = delivered.tools.find((tool) => tool.name === "preset_widget");
  assert.equal(widget.description, "Widget, briefly.");
  assert.equal(widget.parameters.properties.mode.description, "Which mode.");
  // Nested-object override form reaches inside the property's schema.
  assert.equal(widget.parameters.properties.opts.description, "Nested options, shorter.");
  // Untouched nested property keeps its stock description; enum survives.
  assert.equal(widget.parameters.properties.opts.properties.deep.description, "Deep option.");
  assert.deepEqual(widget.parameters.properties.mode.enum, ["fast", "slow"]);
});

test("overrides keep the descriptions-only safety invariant, nested properties included", async () => {
  const { ctx, registered } = capturePlugin();
  apply(ctx, { overrides: { ...bashOverride, ...widgetOverride } });

  const pristine = freshAssembly([presetWidgetTool()]);
  const delivered = await assemble(registered, freshAssembly([presetWidgetTool()]));

  // Stripping every description (tool-level and recursive, including the
  // overridden nested property strings) yields deep-equal catalogs.
  assert.deepEqual(stripDescriptions(delivered.tools), stripDescriptions(pristine.tools));
});

test("override for a property without a stock description adds no field", async () => {
  const { ctx, registered } = capturePlugin();
  apply(ctx, {
    overrides: {
      preset_widget: {
        description: "Widget, briefly.",
        parameters: { properties: { count: "Description for a property that has none." } },
      },
    },
  });

  const widget = presetWidgetTool();
  const delivered = await assemble(registered, freshAssembly([widget]));
  const deliveredWidget = delivered.tools.find((tool) => tool.name === "preset_widget");
  // `count` has no stock description: the transform never adds one, the
  // property node is the identical reference.
  assert.strictEqual(
    deliveredWidget.parameters.properties.count,
    widget.parameters.properties.count,
  );
  // The rest of the override still applies.
  assert.equal(deliveredWidget.description, "Widget, briefly.");
});

test("diagnostics: exactly one log line per assembly with count and correct sizes", async () => {
  const { ctx, registered, lines } = capturePlugin();
  apply(ctx, { diagnostics: true });

  const stock = loadStockTools();
  const delivered = await assemble(registered, freshAssembly());
  assert.equal(lines.length, 1, "one line per assembly");

  const expected =
    `tool-catalog-lean: ${stock.length} tools, ` +
    `${JSON.stringify(stock).length} -> ${JSON.stringify(delivered.tools).length} chars`;
  assert.equal(lines[0], expected);

  // A second assembly emits exactly one more line, identical content.
  await assemble(registered, freshAssembly());
  assert.equal(lines.length, 2);
  assert.equal(lines[1], lines[0]);
});

test("diagnostics off (default and explicit false): no log lines", async () => {
  const offByDefault = capturePlugin();
  apply(offByDefault.ctx);
  await assemble(offByDefault.registered, freshAssembly());
  assert.equal(offByDefault.lines.length, 0);

  const offExplicit = capturePlugin();
  apply(offExplicit.ctx, { diagnostics: false });
  await assemble(offExplicit.registered, freshAssembly());
  assert.equal(offExplicit.lines.length, 0);
});

test("diagnostics never alter the delivered tools", async () => {
  const withDiagnostics = capturePlugin();
  apply(withDiagnostics.ctx, { diagnostics: true });
  const seen = await assemble(withDiagnostics.registered, freshAssembly());
  assert.equal(withDiagnostics.lines.length, 1);

  const withoutDiagnostics = capturePlugin();
  apply(withoutDiagnostics.ctx, {});
  const unseen = await assemble(withoutDiagnostics.registered, freshAssembly());

  assert.deepEqual(seen.tools, unseen.tools);
  assert.equal(JSON.stringify(seen.tools), JSON.stringify(unseen.tools));
});

test("determinism with overrides: two assemblies produce identical output", async () => {
  const { ctx, registered, lines } = capturePlugin();
  apply(ctx, { overrides: { ...bashOverride, ...widgetOverride }, diagnostics: true });

  const first = await assemble(registered, freshAssembly([presetWidgetTool()]));
  const second = await assemble(registered, freshAssembly([presetWidgetTool()]));
  assert.equal(JSON.stringify(first.tools), JSON.stringify(second.tools));
  assert.equal(lines.length, 2);
  assert.equal(lines[0], lines[1], "identical assemblies report identical sizes");
});
