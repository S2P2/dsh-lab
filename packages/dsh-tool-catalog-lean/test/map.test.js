/**
 * Full curated-map tests (#80 of spec #77): coverage, behavior-preservation
 * checklists, curated-path landing (no silent no-ops, byte-identical
 * non-curated paths), and the compression-effect bounds measured against
 * the captured stock catalog.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { projectTools } from "../src/transform.js";
import { descriptionMap, safetyChecklists } from "../src/map.js";
import { loadStockTools, countDescriptionChars } from "./helpers.js";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every description string in one tool schema, concatenated for contains-checks. */
function collectDescriptionText(value, out = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectDescriptionText(child, out);
    return out;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "description" && typeof child === "string") out.push(child);
      else collectDescriptionText(child, out);
    }
  }
  return out;
}

/**
 * Twin-walk the stock schema, the projected schema, and the map entry:
 * at every description position the projected string must equal the
 * curated string where the map provides one, and the stock string where
 * it does not. Also flags curated paths that land nowhere in the stock
 * schema (typos the transform would silently ignore).
 */
function assertMapLandsOnStock(stockNode, projectedNode, replacement, path, problems) {
  if (Array.isArray(stockNode)) {
    stockNode.forEach((child, i) =>
      assertMapLandsOnStock(child, projectedNode?.[i], replacement, `${path}[${i}]`, problems),
    );
    return;
  }
  if (!isPlainObject(stockNode)) return;

  if (typeof stockNode.description === "string") {
    const curated =
      isPlainObject(replacement) && typeof replacement.description === "string"
        ? replacement.description
        : undefined;
    const expected = curated ?? stockNode.description;
    if (projectedNode?.description !== expected) {
      problems.push(
        `${path}.description: expected ${JSON.stringify(expected)}, got ${JSON.stringify(projectedNode?.description)}`,
      );
    }
  } else if (isPlainObject(replacement) && typeof replacement.description === "string") {
    problems.push(`${path}.description: curated replacement but stock has no description here`);
  }

  const curatedProps = isPlainObject(replacement) ? replacement.properties : undefined;
  if (isPlainObject(curatedProps)) {
    for (const key of Object.keys(curatedProps)) {
      if (!isPlainObject(stockNode.properties?.[key])) {
        problems.push(`${path}.properties.${key}: curated but missing from stock schema`);
      }
    }
  }
  for (const [key, child] of Object.entries(stockNode.properties ?? {})) {
    const curated = curatedProps?.[key];
    if (typeof curated === "string") {
      if (typeof child.description !== "string") {
        problems.push(`${path}.properties.${key}: string shorthand but stock has no description`);
      } else if (projectedNode?.properties?.[key]?.description !== curated) {
        problems.push(
          `${path}.properties.${key}.description: expected ${JSON.stringify(curated)}, got ${JSON.stringify(projectedNode?.properties?.[key]?.description)}`,
        );
      }
      continue;
    }
    assertMapLandsOnStock(
      child,
      projectedNode?.properties?.[key],
      isPlainObject(curated) ? curated : undefined,
      `${path}.properties.${key}`,
      problems,
    );
  }

  if (isPlainObject(replacement) && isPlainObject(replacement.items)) {
    if (stockNode.items === undefined) {
      problems.push(`${path}.items: curated but stock has no items here`);
    } else if (Array.isArray(stockNode.items)) {
      stockNode.items.forEach((child, i) =>
        assertMapLandsOnStock(child, projectedNode?.items?.[i], replacement.items, `${path}.items[${i}]`, problems),
      );
    } else {
      assertMapLandsOnStock(stockNode.items, projectedNode?.items, replacement.items, `${path}.items`, problems);
    }
  } else if (stockNode.items !== undefined) {
    const itemsReplacement = isPlainObject(replacement) ? replacement.items : undefined;
    if (Array.isArray(stockNode.items)) {
      stockNode.items.forEach((child, i) =>
        assertMapLandsOnStock(child, projectedNode?.items?.[i], undefined, `${path}.items[${i}]`, problems),
      );
      void itemsReplacement;
    } else {
      assertMapLandsOnStock(stockNode.items, projectedNode?.items, undefined, `${path}.items`, problems);
    }
  }
}

test("map coverage: every fixture tool is curated, with no extra keys", () => {
  const tools = loadStockTools();
  const fixtureNames = tools.map((tool) => tool.name).sort();
  const mapNames = Object.keys(descriptionMap).sort();
  // Every fixture tool has a map entry...
  for (const name of fixtureNames) {
    assert.ok(Object.hasOwn(descriptionMap, name), `missing map entry: ${name}`);
  }
  // ...and map keys are a subset of fixture names (no extras).
  for (const name of mapNames) {
    assert.ok(fixtureNames.includes(name), `map key not in fixture: ${name}`);
  }
  assert.deepEqual(mapNames, fixtureNames);
});

test("checklist coverage: every curated tool has a behavior-preservation checklist", () => {
  assert.deepEqual(Object.keys(safetyChecklists).sort(), Object.keys(descriptionMap).sort());
});

test("per-tool checklists: every safety fact survives the projection", () => {
  const tools = loadStockTools();
  const projected = projectTools(tools, descriptionMap);
  for (const name of Object.keys(descriptionMap)) {
    const tool = projected.find((entry) => entry.name === name);
    const text = collectDescriptionText(tool).join("\n");
    for (const item of safetyChecklists[name]) {
      assert.ok(text.includes(item), `${name}: missing checklist item: ${item}`);
    }
  }
});

test("curated paths land on stock descriptions; non-curated paths stay byte-identical", () => {
  const tools = loadStockTools();
  const projected = projectTools(tools, descriptionMap);
  const problems = [];
  for (const tool of tools) {
    const entry = descriptionMap[tool.name];
    const projectedTool = projected.find((candidate) => candidate.name === tool.name);
    if (typeof entry?.description === "string") {
      if (typeof tool.description !== "string") {
        problems.push(`${tool.name}.description: curated but stock has no description`);
      } else if (projectedTool.description !== entry.description) {
        problems.push(`${tool.name}.description did not land`);
      }
    } else if (projectedTool.description !== tool.description) {
      problems.push(`${tool.name}.description changed without a curated entry`);
    }
    assertMapLandsOnStock(
      tool.parameters,
      projectedTool.parameters,
      entry?.parameters,
      `${tool.name}.parameters`,
      problems,
    );
    assertMapLandsOnStock(
      tool.output_schema,
      projectedTool.output_schema,
      entry?.output_schema,
      `${tool.name}.output_schema`,
      problems,
    );
  }
  assert.deepEqual(problems, []);
});

test("compression effect: bounded minimum reduction, above the over-trimming floor", () => {
  const tools = loadStockTools();
  const projected = projectTools(tools, descriptionMap);

  const descBefore = countDescriptionChars(tools);
  const descAfter = countDescriptionChars(projected);
  const catalogBefore = JSON.stringify(tools).length;
  const catalogAfter = JSON.stringify(projected).length;

  console.log(
    `descriptions: ${descBefore} -> ${descAfter} chars (-${Math.round((1 - descAfter / descBefore) * 100)}%); ` +
      `catalog: ${catalogBefore} -> ${catalogAfter} chars (-${Math.round((1 - catalogAfter / catalogBefore) * 100)}%)`,
  );

  // Bounded minimum: the map must earn its keep...
  assert.ok(
    descAfter <= descBefore * 0.6,
    `expected >=40% description-char reduction (<= ${Math.floor(descBefore * 0.6)}), got ${descAfter}`,
  );
  assert.ok(
    catalogAfter <= catalogBefore * 0.75,
    `expected >=25% catalog-char reduction (<= ${Math.floor(catalogBefore * 0.75)}), got ${catalogAfter}`,
  );
  // ...but stay above the floor that guards against over-trimming.
  assert.ok(
    descAfter > descBefore * 0.2,
    `expected description chars to stay above 20% of stock (> ${Math.ceil(descBefore * 0.2)}), got ${descAfter}`,
  );
});
