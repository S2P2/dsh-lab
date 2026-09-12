/**
 * Transform-level tests: pass-through for unknown tools, determinism, and
 * input purity — run against the real captured fixture plus synthetic and
 * MCP-shaped unknown tools.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { projectTools } from "../src/transform.js";
import { descriptionMap } from "../src/map.js";
import { loadStockTools, countDescriptionChars } from "./helpers.js";

test("fixture provenance: 23 tools, 21,062 compact-serialized chars", () => {
  const tools = loadStockTools();
  assert.equal(tools.length, 23);
  assert.equal(JSON.stringify(tools).length, 21062);
});

test("pass-through: unknown synthetic and MCP-shaped tools are the identical references", () => {
  const unknown = [
    {
      name: "synthetic_future_stock_tool",
      description: "Does something the curated map has never seen.",
      parameters: {
        type: "object",
        properties: {
          nested: {
            type: "object",
            description: "Nested description that must survive untouched.",
            properties: {
              deep: { type: "string", description: "Deep description." },
            },
            items: { type: "string", description: "Item description." },
          },
        },
        required: ["nested"],
      },
    },
    {
      name: "mcp__github__create_issue",
      description: "Create an issue in a GitHub repository (MCP-registered).",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner." },
          labels: {
            type: "array",
            description: "Labels to apply.",
            items: { type: "string", description: "A single label." },
          },
        },
        required: ["owner"],
      },
    },
    { name: "no_parameters_at_all" },
  ];
  const projected = projectTools(unknown, descriptionMap);
  assert.equal(projected.length, unknown.length);
  for (let i = 0; i < unknown.length; i += 1) {
    assert.strictEqual(projected[i], unknown[i], unknown[i].name);
  }
});

test("pass-through: stock-shaped tools absent from the map keep their identical references", () => {
  // The full curated map covers every fixture name, so pass-through is
  // exercised through renamed copies: same schemas, names the map lacks.
  const tools = loadStockTools();
  const renamed = tools.map((tool) => ({ ...tool, name: `${tool.name}__unmapped` }));
  const projected = projectTools(renamed, descriptionMap);
  for (let i = 0; i < renamed.length; i += 1) {
    assert.strictEqual(projected[i], renamed[i], renamed[i].name);
  }
});

test("determinism: two transforms of the same input produce identical output", () => {
  const tools = loadStockTools();
  const first = projectTools(tools, descriptionMap);
  const second = projectTools(tools, descriptionMap);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("purity: the input catalog is never mutated", () => {
  const tools = loadStockTools();
  const before = JSON.stringify(tools);
  projectTools(tools, descriptionMap);
  assert.equal(JSON.stringify(tools), before);
});

test("compression: bash description characters drop by at least a third, floored above over-trimming", () => {
  const tools = loadStockTools();
  const bash = tools.find((tool) => tool.name === "bash");
  const projected = projectTools(tools, descriptionMap).find((tool) => tool.name === "bash");
  const before = countDescriptionChars(bash);
  const after = countDescriptionChars(projected);
  assert.ok(after < (before * 2) / 3, `expected < ${Math.floor((before * 2) / 3)}, got ${after}`);
  // Floor: a wording edit that over-trims far enough to endanger checklist
  // facts trips this before the per-item checklist test becomes vacuous.
  assert.ok(after > 500, `expected a floor above 500 description chars, got ${after}`);
});
