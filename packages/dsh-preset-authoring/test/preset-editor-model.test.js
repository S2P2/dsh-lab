import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	editorFromRows,
	moduleShortName,
	mutateEditor,
	removeEditorRow,
	rowsFromEditor,
} from "../src/preset-editor-model.js";
import { parsePresetYaml } from "../src/preset-yaml.js";

const customCreator = readFileSync(new URL("../../../presets/custom-creator/agent.cordis.yml", import.meta.url), "utf8");

test("editorFromRows builds the editable tree from real composition rows, groups nested", () => {
	const rows = parsePresetYaml(customCreator);
	const editor = editorFromRows(rows);
	assert.equal(editor.length, rows.length);
	const delegation = editor.find((row) => row.id === "delegation");
	assert.equal(delegation.group, true);
	assert.ok(delegation.children.length > 0);
	assert.deepEqual(delegation.children.map((child) => child.key), delegation.children.map((child, index) => `${delegation.key}.${index}`));
	// group config becomes nested children; non-group config becomes YAML text
	const persona = editor.find((row) => row.id === "persona");
	assert.equal(persona.group, false);
	assert.deepEqual(persona.children, []);
	assert.match(persona.configText, /text: \|-/);
	assert.match(persona.configText, /coding agent powered by/);
});

test("rowsFromEditor round-trips row identity; block-scalar blank lines gain upstream padding", () => {
	const original = parsePresetYaml(customCreator);
	const { rows, error } = rowsFromEditor(editorFromRows(original));
	assert.equal(error, null);
	// Upstream-pinned fidelity limit: config text round-trips semantically, but
	// blank lines inside literal block scalars are re-emitted with indentation
	// padding, so deep config equality is not promised — row identity is.
	const key = (row) => `${row.id ?? ""}:${row.name}:${row.group === true}:${JSON.stringify(row.isolate)}`;
	assert.deepEqual(rows.map(key), original.map(key));
	const persona = rows.find((row) => row.id === "persona");
	const personaOriginal = original.find((row) => row.id === "persona");
	assert.equal(persona.config.text.replace(/[ \t]+(?=\n)/g, ""), personaOriginal.config.text.replace(/[ \t]+(?=\n)/g, ""), "persona text survives modulo blank-line padding");
});

test("rowsFromEditor aborts the whole save on bad config YAML (badConfig)", () => {
	const editor = editorFromRows(parsePresetYaml(customCreator));
	const personaKey = editor.find((row) => row.id === "persona").key;
	// the subset has no flow collections: an unbalanced one is a definite error
	for (const configText of ["text: [unclosed", "map: {open", "a: 1\nb: ]wrong["]) {
		const broken = mutateEditor(editor, personaKey, { configText });
		assert.deepEqual(rowsFromEditor(broken), { rows: [], error: "badConfig" }, configText);
	}
	// the original, balanced config still saves
	assert.equal(rowsFromEditor(editor).error, null);
});

test("rowsFromEditor aborts when any row lacks a package name (needPackage)", () => {
	const editor = editorFromRows(parsePresetYaml(customCreator));
	const nameless = mutateEditor(editor, "0", { name: "   " });
	assert.deepEqual(rowsFromEditor(nameless), { rows: [], error: "needPackage" });
	// nested group rows are validated too
	const delegation = editor.find((row) => row.id === "delegation");
	const nestedNameless = mutateEditor(editor, delegation.key, {
		children: mutateEditor(delegation.children, delegation.children[0].key, { name: "" }),
	});
	assert.deepEqual(rowsFromEditor(nestedNameless), { rows: [], error: "needPackage" });
});

test("rowsFromEditor trims ids, drops empty config text, and preserves group isolate", () => {
	const { rows } = rowsFromEditor([
		{ key: "0", id: "  spaced  ", name: " pkg ", disabled: false, group: false, isolate: {}, configText: "", children: [] },
		{ key: "1", id: "", name: "cordis:group", disabled: true, group: true, isolate: { planMode: true }, configText: "", children: [
			{ key: "1.0", id: "nested", name: "@deepseek-ai/dsh-plan-mode", disabled: false, group: false, isolate: {}, configText: "section: hi", children: [] },
		] },
	]);
	assert.deepEqual(rows, [
		{ id: "spaced", name: "pkg" },
		{
			name: "cordis:group",
			disabled: true,
			group: true,
			isolate: { planMode: true },
			config: [{ id: "nested", name: "@deepseek-ai/dsh-plan-mode", config: { section: "hi" } }],
		},
	]);
});

test("mutateEditor and removeEditorRow patch nested group children immutably", () => {
	const editor = editorFromRows(parsePresetYaml(customCreator));
	const delegation = editor.find((row) => row.id === "delegation");
	const nestedKey = delegation.children[0].key;
	const patched = mutateEditor(editor, nestedKey, { id: "renamed" });
	assert.equal(patched.find((row) => row.id === "delegation").children[0].id, "renamed");
	assert.notEqual(patched.find((row) => row.id === "delegation").children, delegation.children, "trees are rebuilt, not mutated");
	assert.equal(editor.find((row) => row.id === "delegation").children[0].id, delegation.children[0].id, "the original tree is untouched");
	const shrunk = removeEditorRow(editor, nestedKey);
	assert.equal(shrunk.find((row) => row.id === "delegation").children.length, delegation.children.length - 1);
	// removing a group row drops its whole subtree
	const flattenedBefore = JSON.stringify(editorFromRows(parsePresetYaml(customCreator))).length;
	const withoutGroup = removeEditorRow(editor, delegation.key);
	assert.ok(JSON.stringify(withoutGroup).length < flattenedBefore);
	assert.equal(withoutGroup.some((row) => row.id === "delegation"), false);
});

test("moduleShortName strips scopes and known prefixes for display", () => {
	assert.equal(moduleShortName("@deepseek-ai/dsh-tool-bash"), "tool-bash");
	assert.equal(moduleShortName("cordis:group"), "group");
	assert.equal(moduleShortName("cordis-plugin-example"), "example");
	assert.equal(moduleShortName("dsh-host-bridge"), "bridge");
	assert.equal(moduleShortName("dsh-client-card"), "card");
	assert.equal(moduleShortName("dsh-tool-web"), "tool-web");
	assert.equal(moduleShortName("mystery-plugin"), "mystery-plugin");
});
