/**
 * Safety-invariant and behavior-preservation tests, run against the real
 * captured 23-tool stock catalog.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { projectTools } from "../src/transform.js";
import { descriptionMap, safetyChecklists } from "../src/map.js";
import { loadStockTools, stripDescriptions } from "./helpers.js";

test("safety invariant: stripping every description yields deep-equal catalogs", () => {
  const tools = loadStockTools();
  const projected = projectTools(tools, descriptionMap);
  assert.deepEqual(stripDescriptions(projected), stripDescriptions(tools));
});

test("bash-only effect: only the bash tool changes, and only its descriptions", () => {
  const tools = loadStockTools();
  const projected = projectTools(tools, descriptionMap);
  assert.equal(projected.length, tools.length);
  for (let i = 0; i < tools.length; i += 1) {
    const isBash = tools[i].name === "bash";
    if (isBash) {
      assert.notStrictEqual(projected[i], tools[i]);
      // Only descriptions differ: names, types, required, enums, structure hold.
      assert.equal(projected[i].name, "bash");
      assert.deepEqual(
        Object.keys(stripDescriptions(projected[i])),
        Object.keys(stripDescriptions(tools[i])),
      );
    } else {
      assert.strictEqual(projected[i], tools[i], tools[i].name);
    }
  }
});

test("bash schema structure survives exactly: untouched parameters keep stock descriptions", () => {
  const tools = loadStockTools();
  const bash = tools.find((tool) => tool.name === "bash");
  const projected = projectTools(tools, descriptionMap).find((tool) => tool.name === "bash");
  // `command` has no curated entry -> byte-identical stock description.
  assert.equal(
    projected.parameters.properties.command.description,
    bash.parameters.properties.command.description,
  );
  // required array and enum pass through untouched.
  assert.deepEqual(projected.parameters.required, bash.parameters.required);
  assert.deepEqual(
    projected.parameters.properties.sandbox_permissions.enum,
    bash.parameters.properties.sandbox_permissions.enum,
  );
  // Curated parameter descriptions did change.
  assert.notEqual(
    projected.parameters.properties.timeoutMs.description,
    bash.parameters.properties.timeoutMs.description,
  );
});

test("bash checklist: every safety fact survives the projection", () => {
  const tools = loadStockTools();
  const projected = projectTools(tools, descriptionMap).find((tool) => tool.name === "bash");
  const text = projected.description;
  for (const item of safetyChecklists.bash) {
    assert.ok(text.includes(item), `missing checklist item: ${item}`);
  }
});

test("compression effect: compact-serialized catalog size decreases", () => {
  const tools = loadStockTools();
  const projected = projectTools(tools, descriptionMap);
  const before = JSON.stringify(tools).length;
  const after = JSON.stringify(projected).length;
  console.log(`catalog compact-JSON size: ${before} -> ${after} chars (-${before - after})`);
  assert.ok(after < before, `expected ${after} < ${before}`);
});
