import assert from "node:assert/strict";
import { test } from "node:test";
import {
	PRESET_COMPOSITION_PATH,
	PRESET_DRAFT_COMMANDS as COMMAND,
	createPresetAuthoringController,
	createPresetDraftService,
	createPresetStudioPresenter,
	createSemanticAdapters,
} from "../src/index.js";

const composition = [
	"# fork of the shipped creator mode",
	"- id: persona",
	"  name: '@deepseek-ai/dsh-persona'",
	"  config:",
	"    text: hello",
	"- id: planning",
	"  name: cordis:group",
	"  group: true",
	"  isolate:",
	"    planMode: true",
	"  config:",
	"    - id: plan-mode",
	"      name: '@deepseek-ai/dsh-plan-mode'",
	"- id: tool-bash",
	"  name: '@deepseek-ai/dsh-tool-bash'",
	"  disabled: !!js process.platform === 'win32'",
	"",
].join("\n");

const testSlot = Object.freeze({ status: "idle", value: null, diagnostic: null });

function studioHarness() {
	const targets = new Map([
		["editable", { id: "editable", editable: true, name: "Editable", trust: "user", files: [{ path: "agent.cordis.yml", content: composition }] }],
		["shipped", { id: "shipped", editable: false, name: "Shipped", trust: "system", description: "Upstream fork", broken: "mount failed at /home/u/secret", files: [{ path: "agent.cordis.yml", content: composition }] }],
	]);
	const host = {
		async listTargets() { return [...targets.values()].map(({ files, ...target }) => target); },
		async readTarget(id) { return targets.get(id); },
	};
	const service = createPresetDraftService({ ...host, ...createSemanticAdapters() });
	const controller = createPresetAuthoringController({ service, host, presenter: createPresetStudioPresenter() });
	return { service, controller };
}

function guarded(panel, command) {
	return { ...command, targetId: panel.target.id, expectedRevision: panel.revision, expectedSourceFingerprint: panel.sourceFingerprint, expectedDraftFingerprint: panel.draftFingerprint };
}

test("studio presenter projects the generic composition view-model, path-free", async () => {
	const { controller } = studioHarness();
	await controller.command({ type: "target.open", targetId: "editable" }, { sessionPresetId: "custom-creator" });
	const view = await controller.command({ type: "panel.snapshot" }, { sessionPresetId: "custom-creator" });

	assert.deepEqual(Object.keys(view), [
		"revision", "sourceFingerprint", "draftFingerprint", "sessionPresetId",
		"targets", "target", "stale", "composition", "semanticDiff", "rawDiff",
		"preflight", "mount", "apply", "history", "test",
	]);
	assert.equal(view.sessionPresetId, "custom-creator");
	assert.deepEqual(view.targets, [
		{ id: "editable", editable: true, title: "Editable", trust: "user" },
		{ id: "shipped", editable: false, title: "Shipped", trust: "system", description: "Upstream fork", broken: true },
	]);
	assert.equal(view.target.id, "editable");
	assert.equal(JSON.stringify(view).includes("/home/"), false, "host paths never reach the panel");
	assert.equal(JSON.stringify(view).includes("mount failed"), false, "breakage details stay Host-side; only presence is projected");

	const compositionView = view.composition;
	assert.equal(compositionView.path, PRESET_COMPOSITION_PATH);
	assert.equal(compositionView.present, true);
	assert.match(compositionView.source, /# fork of the shipped creator mode/);
	assert.equal(compositionView.draft, compositionView.source, "an unedited draft mirrors the saved source");

	assert.deepEqual(compositionView.rows.map(({ depth, kind, id, disabled }) => [depth, kind, id, disabled]), [
		[0, "prompt", "persona", false],
		[0, "group", "planning", false],
		[1, "prompt", "plan-mode", false],
		[0, "tool", "tool-bash", "conditional"],
	]);
	assert.deepEqual(compositionView.rows.map(({ name }) => name), [
		"@deepseek-ai/dsh-persona",
		"cordis:group",
		"@deepseek-ai/dsh-plan-mode",
		"@deepseek-ai/dsh-tool-bash",
	]);

	const editor = compositionView.editor;
	assert.equal(editor.length, 3);
	assert.equal(editor.find((row) => row.id === "persona").configText, "text: hello");
	const planning = editor.find((row) => row.id === "planning");
	assert.equal(planning.group, true);
	assert.deepEqual(planning.children.map((child) => child.id), ["plan-mode"]);
	assert.equal(editor.find((row) => row.id === "tool-bash").disabled, false, "conditional !!js state is displayed, never flipped");
});

test("studio presenter resolves no legacy control ids", () => {
	const presenter = createPresetStudioPresenter();
	assert.equal(presenter.resolveEdit("persona:enabled"), null);
	assert.equal(presenter.resolveEdit("anything"), null);
});

test("draft.putRows serializes the editor tree into the shared draft via the whole-file put", async () => {
	const { service, controller } = studioHarness();
	await controller.command({ type: "target.open", targetId: "editable" });
	let view = await controller.command({ type: "panel.snapshot" });

	const editor = view.composition.editor.map((row) => ({ ...row }));
	const persona = editor.find((row) => row.id === "persona");
	persona.configText = "text: changed";
	view = await controller.command(guarded(view, { type: "draft.putRows", rows: editor }));

	assert.equal(view.composition.draft.includes("# fork of the shipped creator mode"), false, "serialization drops comments — visible in raw diff before Apply");
	assert.match(view.composition.draft, /- id: persona\n  name: '@deepseek-ai\/dsh-persona'\n  config:\n    text: changed\n/);
	assert.equal(view.composition.draft, view.composition.draft.trimEnd() + "\n");
	assert.notEqual(view.composition.draft, view.composition.source, "opening never rewrites; the edit is what diverges the draft");
	assert.equal(view.rawDiff.status, "ready");
	assert.equal(service.getSnapshot().source.tree.length, 1, "the saved target is untouched until Apply");
	const savedText = Buffer.from(service.getSnapshot().source.tree[0].content, "base64").toString("utf8");
	assert.match(savedText, /# fork of the shipped creator mode/, "inspect-only open keeps the original bytes");

	// re-seeding the editor from the saved draft keeps the serialized config text
	assert.equal(view.composition.editor.find((row) => row.id === "persona").configText, "text: changed");
});

test("draft.putRows aborts before any draft mutation on bad rows", async () => {
	const { controller } = studioHarness();
	await controller.command({ type: "target.open", targetId: "editable" });
	const view = await controller.command({ type: "panel.snapshot" });
	const before = view.draftFingerprint;

	const editor = view.composition.editor.map((row) => ({ ...row }));
	editor[0].configText = "text: [unclosed";
	await assert.rejects(
		controller.command(guarded(view, { type: "draft.putRows", rows: editor })),
		(error) => error.code === "PRESET_BAD_ROW_CONFIG",
	);

	const nameless = view.composition.editor.map((row) => ({ ...row }));
	nameless[0].name = " ";
	await assert.rejects(
		controller.command(guarded(view, { type: "draft.putRows", rows: nameless })),
		(error) => error.code === "PRESET_ROW_NEEDS_PACKAGE",
	);

	const after = await controller.command({ type: "panel.snapshot" });
	assert.equal(after.draftFingerprint, before, "aborted saves leave the shared draft untouched");

	// a missing rows array is a caller error, never a silent composition wipe
	await assert.rejects(
		controller.command(guarded(view, { type: "draft.putRows" })),
		(error) => error.code === "INVALID_COMMAND",
	);
});

test("a read-only target rejects studio row saves before any persistence", async () => {
	const { service, controller } = studioHarness();
	await controller.command({ type: "target.open", targetId: "shipped" });
	const view = await controller.command({ type: "panel.snapshot" });
	assert.equal(view.target.editable, false, "the shipped target projects as read-only (containment, not trust)");

	const editor = view.composition.editor.map((row) => ({ ...row }));
	editor[0].configText = "text: hostile";
	await assert.rejects(
		controller.command(guarded(view, { type: "draft.putRows", rows: editor })),
		(error) => error.code === "READ_ONLY_PRESET_TARGET",
	);
	const state = service.getSnapshot();
	assert.equal(state.draft.fingerprint, state.source.fingerprint, "the shared draft is untouched by the refused save");
	assert.equal(state.revision, view.revision, "no state advanced");
});

test("draft.putRows stays CAS-guarded like every draft mutation", async () => {
	const { controller } = studioHarness();
	await controller.command({ type: "target.open", targetId: "editable" });
	const view = await controller.command({ type: "panel.snapshot" });
	const stale = { ...view, revision: view.revision - 1 };
	await assert.rejects(
		controller.command(guarded(stale, { type: "draft.putRows", rows: [] })),
		(error) => error.code === "PRESET_DRAFT_CONFLICT",
	);
});

test("composition presence degrades honestly when the preset has no agent.cordis.yml or non-text bytes", async () => {
	const targets = new Map([
		["binary", { id: "binary", editable: true, files: [{ path: "agent.cordis.yml", content: Buffer.from([0xff, 0xfe, 0x00]) }] }],
		["empty", { id: "empty", editable: true, files: [{ path: "preset.yml", content: "name: empty\n" }] }],
	]);
	const host = {
		async listTargets() { return [...targets.values()].map(({ files, ...target }) => target); },
		async readTarget(id) { return targets.get(id); },
	};
	const service = createPresetDraftService(host);
	const controller = createPresetAuthoringController({ service, host, presenter: createPresetStudioPresenter() });

	let view = await controller.command({ type: "target.open", targetId: "binary" });
	assert.equal(view.composition.present, false);
	assert.equal(view.composition.editor, undefined);
	view = await controller.command({ type: "target.open", targetId: "empty" });
	assert.equal(view.composition.present, false);
	// a first row save creates the composition file through the same put path
	const saved = await controller.command(guarded(view, {
		type: "draft.putRows",
		rows: [{ key: "new-1", id: "first", name: "mystery-plugin", disabled: false, group: false, isolate: {}, configText: "", children: [] }],
	}));
	assert.equal(saved.composition.present, true);
	assert.match(saved.composition.draft, /- id: first\n  name: mystery-plugin\n/);
});

test("the shipped flow activates the studio presenter by default and keeps the semantic presenter swappable", async () => {
	const { createHostPresetAuthoring, createPresetPanelPresenter } = await import("../src/index.js");
	const targets = new Map([["editable", { id: "editable", editable: true, files: [{ path: "agent.cordis.yml", content: composition }] }]]);
	const host = {
		editableRoot() { return "/preset-root"; },
		async listTargets() { return [...targets.values()].map(({ files, ...target }) => target); },
		async readTarget(id) { return targets.get(id); },
	};
	const git = {
		root: "/preset-root",
		withRootLock: (operation) => operation({ async ensureTargetBaseline() { return { status: "ready" }; }, async recordHead() { return { status: "ready", revision: "init" }; }, async commitTarget() { return { status: "ready", revision: "rev-1", committed: true }; }, async restoreTarget() { return { status: "ready" }; } }),
		async listHistory() { return { status: "ready", entries: [] }; },
		async restoreTarget() { return { status: "ready" }; },
	};
	const flow = createHostPresetAuthoring(null, { host, git });
	await flow.service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "editable" });
	const view = await flow.controller.command({ type: "panel.snapshot" });
	assert.equal(Object.hasOwn(view, "composition"), true, "shipped default projection is the studio view-model");

	const semanticFlow = createHostPresetAuthoring(null, { host, git, presenter: createPresetPanelPresenter() });
	await semanticFlow.service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "editable" });
	const semanticView = await semanticFlow.controller.command({ type: "panel.snapshot" });
	assert.equal(Object.hasOwn(semanticView, "inspection"), true, "the old semantic presenter remains a drop-in swap");
});
