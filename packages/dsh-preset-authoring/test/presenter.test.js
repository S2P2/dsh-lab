import assert from "node:assert/strict";
import { test } from "node:test";
import {
	PRESET_DRAFT_COMMANDS as COMMAND,
	PRESET_PANEL_COMMANDS,
	createHostPresetAuthoring,
	createPresetAuthoringController,
	createPresetDraftService,
	createPresetPanelPresenter,
	createSemanticAdapters,
	decodePresetText,
} from "../src/index.js";

const composition = [
	"- id: persona",
	"  name: '@deepseek-ai/dsh-persona'",
	"  config:",
	"    text: hello",
	"- id: pruner",
	"  name: '@deepseek-ai/dsh-compaction-tool-result-pruner'",
	"- id: unknown",
	"  name: mystery-plugin",
	"  disabled: !!js env.FLAG",
	"",
].join("\n");

function guarded(service, command) {
	const state = service.getSnapshot();
	return service.dispatch({
		...command,
		targetId: state.target.id,
		expectedRevision: state.revision,
		expectedSourceFingerprint: state.source.fingerprint,
		expectedDraftFingerprint: state.draft.fingerprint,
	});
}

function harness() {
	const targets = new Map([
		["editable", { id: "editable", editable: true, name: "Editable", files: [{ path: "agent.cordis.yml", content: composition }] }],
		["system", { id: "system", editable: false, name: "System", files: [{ path: "agent.cordis.yml", content: composition }] }],
	]);
	const host = {
		async listTargets() { return [...targets.values()].map(({ files, ...target }) => target); },
		async readTarget(id) { return targets.get(id); },
	};
	const service = createPresetDraftService({ ...host, ...createSemanticAdapters() });
	return { service, host };
}

const testSlot = Object.freeze({ status: "idle", value: null, diagnostic: null });

test("panel command vocabulary is one frozen, explicit contract", () => {
	assert.deepEqual(PRESET_PANEL_COMMANDS, {
		PANEL_SNAPSHOT: "panel.snapshot",
		TARGET_OPEN: "target.open",
		TARGET_COPY: "target.copy",
		DRAFT_EDIT: "draft.edit",
		DRAFT_TOGGLE: "draft.toggle",
		DRAFT_PUT_ROWS: "draft.putRows",
		DRAFT_REFRESH_ANALYSIS: "draft.refreshAnalysis",
		DRAFT_VALIDATE_MOUNT: "draft.validateMount",
		DRAFT_APPLY: "draft.apply",
		HISTORY_LOAD: "history.load",
		HISTORY_RESTORE: "history.restore",
		TEST_START: "test.start",
		INVENTORY_LIST: "inventory.list",
	});
	assert.equal(Object.isFrozen(PRESET_PANEL_COMMANDS), true);
});

test("presenter projects the documented path-free view-model from service state", async () => {
	const { service, host } = harness();
	await service.dispatch({ type: COMMAND.SET_SESSION, presetId: "custom-creator" });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "editable" });
	await guarded(service, { type: COMMAND.REFRESH_ANALYSIS });
	const state = service.getSnapshot();
	const targets = await host.listTargets();

	const view = createPresetPanelPresenter().project({ state, targets, sessionPresetId: undefined, test: testSlot });

	assert.deepEqual(Object.keys(view), [
		"revision", "sourceFingerprint", "draftFingerprint", "sessionPresetId",
		"targets", "target", "stale", "inspection", "semanticDiff", "rawDiff",
		"preflight", "mount", "apply", "history", "test",
	]);
	assert.equal(view.sessionPresetId, "custom-creator");
	assert.equal(view.revision, state.revision);
	assert.equal(view.sourceFingerprint, state.source.fingerprint);
	assert.equal(view.draftFingerprint, state.draft.fingerprint);
	assert.deepEqual(view.targets, [
		{ id: "editable", editable: true, title: "Editable" },
		{ id: "system", editable: false, title: "System" },
	]);
	assert.deepEqual(view.target, { id: "editable", editable: true });
	assert.equal(JSON.stringify(view).includes(state.draft.tree[0].content), false, "canonical draft trees never reach the view-model");

	const categories = view.inspection.categories;
	assert.deepEqual(categories.map((category) => [category.id, category.title]), [
		["prompt", "Prompt"], ["model", "Model"], ["plugins", "Plugins"], ["skills", "Skills"],
		["tools", "Tools"], ["mcp", "MCP"], ["other", "Other"],
	]);
	const rows = categories.flatMap((category) => category.rows);
	const personaText = rows.find((row) => row.id === "persona:config.text");
	assert.equal(personaText.editable, true);
	assert.deepEqual(personaText.control, { type: "text" });
	assert.equal(personaText.value, "hello");
	assert.equal(personaText.provenance, "explicit");
	const personaToggle = rows.find((row) => row.id === "persona:enabled");
	assert.deepEqual(personaToggle.control, { type: "toggle" });
	const prunerThreshold = rows.find((row) => row.id === "pruner:config.thresholdChars");
	assert.deepEqual(prunerThreshold.control, { type: "number" });
	assert.equal(prunerThreshold.value, 8192);
	assert.equal(prunerThreshold.default, 8192);
	assert.equal(prunerThreshold.provenance, "default");
	const unknown = rows.find((row) => row.id === "unknown");
	assert.equal(unknown.editable, false);
	assert.equal(unknown.control, undefined);
	assert.equal(unknown.metadata, "uninspected");
});

test("resolveEdit maps projected control ids to narrow Host-supported edits", async () => {
	const { service, host } = harness();
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "editable" });
	await guarded(service, { type: COMMAND.REFRESH_ANALYSIS });
	const presenter = createPresetPanelPresenter();
	presenter.project({ state: service.getSnapshot(), targets: await host.listTargets(), sessionPresetId: null, test: testSlot });

	assert.deepEqual(presenter.resolveEdit("persona:enabled"), { operation: "setEnabled", rowId: "persona" });
	assert.deepEqual(presenter.resolveEdit("persona:config.text"), { operation: "setField", rowId: "persona", path: "config.text" });
	assert.deepEqual(presenter.resolveEdit("pruner:config.headChars"), { operation: "setField", rowId: "pruner", path: "config.headChars" });
	assert.equal(presenter.resolveEdit("unknown"), null);
	assert.equal(presenter.resolveEdit("unknown:enabled"), null, "uninspected rows expose no controls");
	assert.equal(presenter.resolveEdit("persona"), null);
});

test("each projection rebuilds its control set from the current state only", async () => {
	const { service, host } = harness();
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "editable" });
	const opened = service.getSnapshot();
	await guarded(service, { type: COMMAND.REFRESH_ANALYSIS });
	const analyzed = service.getSnapshot();
	const presenter = createPresetPanelPresenter();
	const targets = await host.listTargets();

	presenter.project({ state: analyzed, targets, sessionPresetId: null, test: testSlot });
	assert.notEqual(presenter.resolveEdit("persona:enabled"), null);
	presenter.project({ state: opened, targets, sessionPresetId: null, test: testSlot });
	assert.equal(presenter.resolveEdit("persona:enabled"), null, "stale control ids stop resolving after re-projection");
});

test("controller drives the backend through any presenter honoring the interface", async () => {
	const { service, host } = harness();
	const presenter = {
		project({ state, targets, sessionPresetId, test }) {
			return { surface: "replacement", targetId: state.target?.id ?? null, roster: targets.length, sessionPresetId, test };
		},
		resolveEdit(rowId) {
			return rowId === "replacement-field" ? { operation: "setField", rowId: "persona", path: "config.text" } : null;
		},
	};
	const controller = createPresetAuthoringController({ service, host, presenter });
	await controller.command({ type: "target.open", targetId: "editable" });
	const view = await controller.command({ type: "panel.snapshot" }, { sessionPresetId: "creator" });
	assert.equal(view.surface, "replacement");
	assert.equal(view.targetId, "editable");
	assert.equal(view.sessionPresetId, "creator");

	const state = service.getSnapshot();
	await controller.command({
		type: "draft.edit",
		rowId: "replacement-field",
		value: "swapped",
		targetId: state.target.id,
		expectedRevision: state.revision,
		expectedSourceFingerprint: state.source.fingerprint,
		expectedDraftFingerprint: state.draft.fingerprint,
	});
	assert.match(JSON.stringify(service.getSnapshot().draft.tree), /c3dhcHBlZA/);
	await assert.rejects(
		controller.command({ type: "draft.toggle", rowId: "replacement-field", enabled: false }),
		(error) => error.code === "CONDITIONAL_ROW_STATE",
	);
});

test("controller rejects presenters that do not honor the interface", () => {
	const { service, host } = harness();
	assert.throws(
		() => createPresetAuthoringController({ service, host, presenter: { project() {} } }),
		/presenter must provide project\(\) and resolveEdit\(\)/,
	);
	assert.throws(
		() => createPresetAuthoringController({ service, host, presenter: { resolveEdit() {} } }),
		/presenter must provide project\(\) and resolveEdit\(\)/,
	);
});

function memoryBackend() {
	let files = [{ path: "agent.cordis.yml", content: "- id: ok\n  name: valid\n" }];
	const initial = { revision: "init", subject: "Initialize editable presets", files: files.map((file) => ({ ...file })) };
	const commits = [initial];
	const fromTree = (tree) => tree.map((file) => ({ path: file.path, content: Buffer.from(file.content, "base64") }));
	const host = {
		editableRoot() { return "/preset-root"; },
		async listTargets() { return [{ id: "target", editable: true }]; },
		async readTarget() { return { id: "target", editable: true, files }; },
		async gitTarget() { return "target"; },
		async materializeTarget(id, tree) { files = fromTree(tree); },
		async validateMaterializedTarget() { return { standingKey: { agentPreset: "target" } }; },
		async restoreTarget(id, tree) { files = fromTree(tree); },
	};
	const locked = {
		async ensureTargetBaseline() { return { status: "ready", revision: commits.at(-1).revision }; },
		async recordHead() { return { status: "ready", revision: commits.at(-1).revision }; },
		async commitTarget(pathspec, message) {
			const revision = `rev-${commits.length}`;
			commits.push({ revision, subject: message, files: files.map((file) => ({ ...file })) });
			return { status: "ready", revision, committed: true };
		},
		async restoreTarget(pathspec, revision) {
			const entry = commits.find((candidate) => candidate.revision === revision);
			if (!entry) return { status: "degraded", operation: "restoreTarget", diagnostic: { message: `unknown revision ${revision}` } };
			files = entry.files.map((file) => ({ ...file }));
			return { status: "ready", revision };
		},
	};
	const git = {
		root: "/preset-root",
		withRootLock: (operation) => operation(locked),
		async listHistory() { return { status: "ready", entries: [...commits].reverse().map(({ revision, subject }) => ({ revision, subject })) }; },
		async restoreTarget(target, revision) { return locked.restoreTarget(target, revision); },
	};
	return { host, git };
}

test("Host backend completes the whole draft lifecycle with no presentation attached", async () => {
	const backend = memoryBackend();
	const flow = createHostPresetAuthoring(null, { host: backend.host, git: backend.git, panel: false });
	assert.equal(flow.controller, null);
	const service = flow.service;

	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await guarded(service, { type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "- id: ok\n  name: valid\n  disabled: true\n" });
	await guarded(service, { type: COMMAND.REFRESH_ANALYSIS });
	await guarded(service, { type: COMMAND.VALIDATE_MOUNT });
	assert.deepEqual(service.getSnapshot().mount.value, { standingKey: { agentPreset: "target" } });
	assert.equal(decodePresetText(service.getSnapshot().source.tree[0]), "- id: ok\n  name: valid\n", "validation never persists the candidate");

	await guarded(service, { type: COMMAND.APPLY });
	const applied = service.getSnapshot();
	assert.equal(applied.apply.status, "ready");
	assert.equal(applied.apply.value.saved, true);
	assert.equal(applied.apply.value.revision, "rev-1");
	assert.equal(applied.stale, false);
	assert.equal(applied.source.fingerprint, applied.draft.fingerprint);

	await guarded(service, { type: COMMAND.LOAD_HISTORY });
	const history = service.getSnapshot().history.value;
	assert.deepEqual(history.map(({ revision }) => revision), ["rev-1", "init"]);

	await guarded(service, { type: COMMAND.RESTORE_HISTORY, revision: "init" });
	const restored = service.getSnapshot();
	assert.equal(restored.history.status, "ready");
	assert.equal(decodePresetText(restored.source.tree[0]), "- id: ok\n  name: valid\n");
	assert.equal(restored.source.fingerprint, restored.draft.fingerprint);
});
