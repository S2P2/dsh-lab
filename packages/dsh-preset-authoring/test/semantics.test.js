import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
	PRESET_DRAFT_COMMANDS as COMMAND,
	createPresetDraftService,
	createSemanticAdapters,
	decodePresetText,
} from "../src/index.js";

const creatorPath = new URL("../../../presets/custom-creator/agent.cordis.yml", import.meta.url);

function memoryTarget(content) {
	return {
		async readTarget(id) {
			return { id, editable: true, files: [{ path: "agent.cordis.yml", content }] };
		},
	};
}

function draftYaml(service) {
	return decodePresetText(service.getSnapshot().draft.tree.find((file) => file.path === "agent.cordis.yml"));
}

test("shared draft seam inspects a real DSH composition without evaluating !!js", async () => {
	const source = await readFile(creatorPath, "utf8");
	const service = createPresetDraftService({ ...memoryTarget(source), ...createSemanticAdapters() });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "custom-creator" });
	await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });

	const state = service.getSnapshot();
	assert.equal(state.preflight.status, "ready");
	assert.deepEqual(state.preflight.value.diagnostics, []);
	assert.deepEqual(state.inspection.value.categories.map(({ id }) => id), [
		"Prompt", "Model", "Plugins", "Skills", "Tools", "MCP", "Other",
	]);

	const rows = state.inspection.value.categories.flatMap((category) => category.rows);
	const persona = rows.find((row) => row.id === "persona");
	assert.equal(persona.category, "Prompt");
	assert.equal(persona.inspection, "verified");
	assert.deepEqual(persona.promptProvenance, {
		kind: "persona",
		producer: "@deepseek-ai/dsh-persona",
		source: "config.text",
		scope: "authoring-time",
	});
	assert.equal(persona.fields.find((field) => field.path === "config.text").value.includes("coding agent"), true);

	const instructions = rows.find((row) => row.id === "agent-instructions");
	assert.equal(instructions.promptProvenance.kind, "workspace-instructions");
	const planMode = rows.find((row) => row.id === "plan-mode");
	assert.equal(planMode.promptProvenance.kind, "plan-mode-section");

	assert.deepEqual(rows.find((row) => row.id === "tool-bash").state, {
		kind: "conditional",
		expression: "process.platform === 'win32'",
	});
	assert.deepEqual(rows.find((row) => row.id === "tool-subagent-codex").state, { kind: "disabled" });
	assert.deepEqual(rows.find((row) => row.id === "tool-fs").state, { kind: "enabled" });

	const unknown = rows.find((row) => row.id === "planning");
	assert.equal(unknown.inspection, "uninspected");
	assert.equal(unknown.metadata, null);
	assert.deepEqual(unknown.defaults, {});
});

test("semantic edit changes only an existing scalar and keeps comments and surrounding text", async () => {
	const source = `# header stays\n- id: web\n  name: '@deepseek-ai/dsh-tool-web'\n  config:\n    fetch: true # keep this comment\n    searchTimeoutMs: 60000\n\n- id: mystery\n  name: third-party-plugin\n`;
	const service = createPresetDraftService({ ...memoryTarget(source), ...createSemanticAdapters() });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({
		type: COMMAND.EDIT_SEMANTIC,
		rowId: "web",
		operation: "setField",
		path: "config.fetch",
		value: false,
	});

	assert.equal(draftYaml(service), source.replace("fetch: true", "fetch: false"));
	assert.equal(service.getSnapshot().preflight.status, "idle", "semantic edits invalidate analysis channels");
	await assert.rejects(
		service.dispatch({
			type: COMMAND.EDIT_SEMANTIC,
			rowId: "mystery",
			operation: "setField",
			path: "config.guess",
			value: true,
		}),
		(error) => error.code === "UNSUPPORTED_SEMANTIC_EDIT",
	);
});

test("multiline field edits remain valid without reformatting the composition", async () => {
	const source = `# preserve\n- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: |-\n      old text\n- id: next\n  name: unknown-mcp-plugin\n`;
	const service = createPresetDraftService({ ...memoryTarget(source), ...createSemanticAdapters() });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.EDIT_SEMANTIC, rowId: "persona", operation: "setField", path: "config.text", value: "first\nsecond" });
	await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });

	assert.equal(service.getSnapshot().preflight.value.valid, true);
	assert.equal(service.getSnapshot().inspection.value.categories[0].rows[0].fields[0].value, "first\nsecond");
	assert.equal(service.getSnapshot().inspection.value.categories[2].rows[0].inspection, "uninspected");
	assert.equal(service.getSnapshot().inspection.value.categories[5].rows.length, 0, "unknown names are not guessed to be MCP");
	assert.match(draftYaml(service), /^# preserve/m);
});

test("boolean row toggles are safe while conditional !!js state is preserved", async () => {
	const source = `- id: plain\n  name: '@deepseek-ai/dsh-tool-fs'\n- id: off\n  name: '@deepseek-ai/dsh-tool-web'\n  disabled: true # reason\n- id: conditional\n  name: '@deepseek-ai/dsh-tool-bash'\n  disabled: !!js process.platform === 'win32'\n`;
	const service = createPresetDraftService({ ...memoryTarget(source), ...createSemanticAdapters() });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.EDIT_SEMANTIC, rowId: "plain", operation: "setEnabled", enabled: false });
	await service.dispatch({ type: COMMAND.EDIT_SEMANTIC, rowId: "off", operation: "setEnabled", enabled: true });

	const edited = draftYaml(service);
	assert.match(edited, /name: '@deepseek-ai\/dsh-tool-fs'\n  disabled: true/);
	assert.match(edited, /disabled: false # reason/);
	await assert.rejects(
		service.dispatch({ type: COMMAND.EDIT_SEMANTIC, rowId: "conditional", operation: "setEnabled", enabled: false }),
		(error) => error.code === "CONDITIONAL_ROW_STATE",
	);
	assert.match(draftYaml(service), /disabled: !!js process\.platform === 'win32'/);
});

test("known metadata exposes only declared fields and deterministic defaults", async () => {
	const source = `- id: model\n  name: example-model\n  config:\n    temperature: 0.2\n    privateOption: secret\n`;
	const adapters = createSemanticAdapters({
		plugins: {
			"example-model": {
				category: "Model",
				label: "Example model",
				fields: { "config.temperature": { type: "number", default: 1 } },
			},
		},
	});
	const service = createPresetDraftService({ ...memoryTarget(source), ...adapters });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });

	const row = service.getSnapshot().inspection.value.categories[1].rows[0];
	assert.equal(row.inspection, "verified");
	assert.deepEqual(row.defaults, { "config.temperature": 1 });
	assert.deepEqual(row.fields.map((field) => field.path), ["config.temperature"]);
	assert.equal(JSON.stringify(row).includes("privateOption"), false);
});

test("semantic summary surfaces uninspected and preset-local file changes without guessing details", async () => {
	const source = `- id: mystery\n  name: third-party-plugin\n  config:\n    opaque: one\n`;
	const service = createPresetDraftService({ ...memoryTarget(source), ...createSemanticAdapters() });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: source.replace("opaque: one", "opaque: two") });
	await service.dispatch({ type: COMMAND.PUT_FILE, path: "skills/local/SKILL.md", content: "instructions" });
	await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });

	assert.deepEqual(service.getSnapshot().semanticDiff.value.changes, [
		{ category: "Plugins", kind: "row.changed", rowId: "mystery", inspection: "uninspected" },
		{ category: "Skills", kind: "file.added", path: "skills/local/SKILL.md" },
	]);
});

test("cheap preflight, semantic summary, and raw diff report through adapter lifecycle slots", async () => {
	const source = `- id: web\n  name: '@deepseek-ai/dsh-tool-web'\n  config:\n    fetch: true\n`;
	const service = createPresetDraftService({ ...memoryTarget(source), ...createSemanticAdapters() });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.EDIT_SEMANTIC, rowId: "web", operation: "setField", path: "config.fetch", value: false });
	await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });

	const state = service.getSnapshot();
	assert.deepEqual(state.preflight.value, { valid: true, diagnostics: [] });
	assert.deepEqual(state.semanticDiff.value.changes, [{
		category: "Tools",
		kind: "field.changed",
		rowId: "web",
		path: "config.fetch",
		before: true,
		after: false,
	}]);
	assert.match(state.rawDiff.value, /--- a\/agent\.cordis\.yml/);
	assert.match(state.rawDiff.value, /-    fetch: true/);
	assert.match(state.rawDiff.value, /\+    fetch: false/);

	await service.dispatch({ type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "not: [valid" });
	await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });
	assert.equal(service.getSnapshot().preflight.value.valid, false);
	assert.equal(service.getSnapshot().preflight.value.diagnostics[0].code, "YAML_PARSE_ERROR");
});
