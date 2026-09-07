import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	categorizeRow,
	flattenRows,
	isJsExpr,
	parsePresetYaml,
	parseYamlValue,
	stringifyPresetYaml,
	stringifyYamlValue,
	toPresetRows,
} from "../src/preset-yaml.js";

// Real repo preset fixtures (≈ upstream's shipped src/main/agent-presets).
const presetRoot = new URL("../../../presets/", import.meta.url);

function load(preset) {
	return readFileSync(new URL(`${preset}/agent.cordis.yml`, presetRoot), "utf8");
}

test("parses the real custom-creator preset", () => {
	const rows = parsePresetYaml(load("custom-creator"));
	assert.ok(rows.length > 10, `expected a substantive composition, got ${rows.length}`);
	const names = rows.map((r) => r.name);
	assert.ok(names.includes("@deepseek-ai/dsh-persona"));
	assert.ok(names.includes("@deepseek-ai/dsh-tool-bash"));
	// the platform-guarded `!!js` expression parses as an inert JsExpr
	const bash = rows.find((r) => r.id === "tool-bash");
	assert.ok(bash && (bash.disabled === undefined || isJsExpr(bash.disabled)));
	assert.deepStrictEqual(bash.disabled, { __jsExpr: "process.platform === 'win32'" });
});

test("parses nested groups and isolate realms", () => {
	const rows = parsePresetYaml(load("custom-creator"));
	const planning = rows.find((r) => r.id === "planning");
	assert.equal(planning?.group, true);
	assert.deepEqual(planning?.isolate, { planMode: true });
	const delegation = rows.find((r) => r.id === "delegation");
	assert.equal(delegation?.group, true);
	assert.ok(Array.isArray(delegation?.config));
	// nested rows are representable through the same coercion
	const nested = toPresetRows(delegation?.config);
	assert.ok(nested.some((r) => r.id === "tool-subagent"));
	const subagent = nested.find((r) => r.id === "tool-subagent");
	assert.deepEqual(subagent?.config, { provider: "spawn", toolName: "subagent", modelSelectionSettings: true, backgroundMode: "continuable" });
});

test("round-trips flattened row identity (id/name/kind) through stringify for every repo preset", () => {
	for (const preset of ["custom-creator", "writing"]) {
		const original = load(preset);
		const a = flattenRows(parsePresetYaml(original));
		const b = flattenRows(parsePresetYaml(stringifyPresetYaml(parsePresetYaml(original))));
		const key = (r) => `${r.depth}:${r.row.id ?? ""}:${r.row.name}:${r.kind}`;
		assert.deepEqual(b.map(key), a.map(key), `${preset} keeps row identity across the round-trip`);
	}
});

test("round-trip honesty: comments are dropped and nothing stronger than row identity is promised", () => {
	const original = load("custom-creator");
	assert.match(original, /^# /m, "fixture carries header comments");
	const serialized = stringifyPresetYaml(parsePresetYaml(original));
	assert.doesNotMatch(serialized, /^# /m, "comments never survive serialization");
	// folded block scalars re-emit as literal blocks; the text content survives
	assert.match(load("writing"), /text: >-/);
	const writingRows = parsePresetYaml(load("writing"));
	const personaText = writingRows.find((r) => r.id === "persona")?.config?.text;
	assert.match(personaText, /writing-focused agent/);
	const roundTripped = parsePresetYaml(stringifyPresetYaml(writingRows)).find((r) => r.id === "persona");
	assert.equal(roundTripped?.config?.text, personaText);
});

test("categorizes tools / prompt / delegation / group rows like upstream", () => {
	assert.equal(categorizeRow("@deepseek-ai/dsh-tool-bash"), "tool");
	assert.equal(categorizeRow("@deepseek-ai/dsh-persona"), "prompt");
	// delegation wins over tool: the delegation check runs first
	assert.equal(categorizeRow("@deepseek-ai/dsh-tool-subagent"), "delegation");
	assert.equal(categorizeRow("@deepseek-ai/dsh-tool-workflow"), "delegation");
	assert.equal(categorizeRow("@deepseek-ai/dsh-tool-ralph"), "delegation");
	assert.equal(categorizeRow("cordis:group", true), "group");
	assert.equal(categorizeRow("cordis:group"), "group");
	assert.equal(categorizeRow("mystery-plugin"), "other");
});

test("unknown rows stay representable; unknown row keys are dropped by the coercion", () => {
	const rows = parsePresetYaml([
		"- id: known",
		"  name: mystery-plugin",
		"  futureKey: value",
		"  config:",
		"    anything: {goes}",
		"",
	].join("\n"));
	assert.equal(rows.length, 1);
	assert.equal(rows[0].name, "mystery-plugin");
	// `config` bodies are opaque, so arbitrary nested config round-trips
	assert.deepEqual(rows[0].config, { anything: "{goes}" });
	const serialized = stringifyPresetYaml(rows);
	assert.doesNotMatch(serialized, /futureKey/, "unknown top-level row keys do not survive toRows");
	assert.deepEqual(parsePresetYaml(serialized)[0].config, { anything: "{goes}" });
});

test("flattenRows recurses into groups with depth and kind", () => {
	const flat = flattenRows(parsePresetYaml(load("custom-creator")));
	const delegationAt = flat.findIndex((f) => f.row.id === "delegation");
	const nestedAt = flat.findIndex((f) => f.row.id === "tool-subagent");
	assert.ok(delegationAt >= 0 && nestedAt > delegationAt);
	assert.equal(flat[delegationAt].depth, 0);
	assert.equal(flat[delegationAt].kind, "group");
	assert.equal(flat[nestedAt].depth, 1);
	assert.equal(flat[nestedAt].kind, "delegation");
});

test("parseYamlValue / stringifyYamlValue drive the per-row config textareas", () => {
	assert.deepEqual(parseYamlValue("provider: spawn\nmaxDepth: 3\n"), { provider: "spawn", maxDepth: 3 });
	assert.equal(stringifyYamlValue({ provider: "spawn", maxDepth: 3 }), "provider: spawn\nmaxDepth: 3");
	assert.equal(stringifyYamlValue(undefined), "");
	assert.equal(stringifyYamlValue("plain"), "plain");
	// quoted scalars that look like booleans/numbers survive a round trip
	assert.deepEqual(parseYamlValue("flag: 'true'"), { flag: "true" });
	assert.deepEqual(parseYamlValue("flag: true"), { flag: true });
	assert.deepEqual(parseYamlValue("limit: 8192"), { limit: 8192 });
	// multi-line field values re-emit as literal block scalars and parse back
	const text = stringifyYamlValue({ section: "line one\nline two" });
	assert.match(text, /section: \|-/);
	assert.deepEqual(parseYamlValue(text), { section: "line one\nline two" });
});

test("stringifyPresetYaml normalizes key order and quotes look-alike scalars", () => {
	const yaml = stringifyPresetYaml([
		{ config: { threshold: 8192 }, name: "dsh-tool-x", disabled: true, id: "x" },
	]);
	assert.match(yaml, /- id: x\n  name: dsh-tool-x\n  disabled: true\n  config:\n    threshold: 8192\n/);
	assert.equal(stringifyPresetYaml([]), "[]\n");
	const quoted = stringifyPresetYaml([{ name: "true" }]);
	assert.match(quoted, /name: 'true'/);
});

test("parsePresetYaml returns [] for empty documents instead of throwing", () => {
	assert.deepEqual(parsePresetYaml(""), []);
	assert.deepEqual(parsePresetYaml("# just a comment\n"), []);
	assert.deepEqual(parsePresetYaml("[]"), []);
	assert.doesNotThrow(() => parsePresetYaml("- name: 'unterminated"));
});
