import assert from "node:assert/strict";
import { test } from "node:test";
import { createPresetAuthoringController, createPresetDraftService, createSemanticAdapters } from "../src/index.js";

const composition = `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: hello\n- id: unknown\n  name: mystery-plugin\n  disabled: !!js env.FLAG\n`;

function harness() {
	const targets = new Map([
		["system", { id: "system", editable: false, files: [{ path: "agent.cordis.yml", content: composition }] }],
		["editable", { id: "editable", editable: true, files: [{ path: "agent.cordis.yml", content: composition }] }],
	]);
	const host = {
		async listTargets() { return [...targets.values()].map(({ files, ...target }) => target); },
		async readTarget(id) { return targets.get(id); },
		async copyTarget(sourceId, targetId) {
			const source = targets.get(sourceId);
			const copied = { ...source, id: targetId, editable: true };
			targets.set(targetId, copied);
			return copied;
		},
	};
	const service = createPresetDraftService({ ...host, ...createSemanticAdapters() });
	return { service, controller: createPresetAuthoringController({ service, host }), targets };
}

test("controller projects path-free semantic controls and shares UI edits with bridge callers", async () => {
	const { service, controller } = harness();
	await controller.command({ type: "target.open", targetId: "editable" }, { sessionPresetId: "custom-creator" });
	let panel = await controller.command({ type: "panel.snapshot" }, { sessionPresetId: "custom-creator" });
	assert.equal(panel.sessionPresetId, "custom-creator");
	assert.equal(JSON.stringify(panel).includes("/home/"), false);
	const prompt = panel.inspection.categories.find((category) => category.id === "prompt");
	const field = prompt.rows.find((row) => row.control?.type === "text");
	assert.ok(field);
	await controller.command({ type: "draft.edit", rowId: field.id, value: "changed" });
	assert.match(JSON.stringify(service.getSnapshot().draft.tree), /Y2hhbmdlZA|changed/);
	panel = await controller.command({ type: "panel.snapshot" });
	const unknown = panel.inspection.categories.find((category) => category.id === "plugins").rows[0];
	assert.equal(unknown.editable, false);
	assert.equal(unknown.control, undefined);
});

test("copy-first opens the native editable copy without changing session preset", async () => {
	const { controller } = harness();
	await controller.command({ type: "target.open", targetId: "system" }, { sessionPresetId: "creator" });
	const panel = await controller.command({ type: "target.copy", sourceId: "system", targetId: "copy" }, { sessionPresetId: "creator" });
	assert.equal(panel.target.id, "copy");
	assert.equal(panel.target.editable, true);
	assert.equal(panel.sessionPresetId, "creator");
});

test("request session presets project independently without mutating shared target state", async () => {
	const { service, controller } = harness();
	await controller.command({ type: "target.open", targetId: "editable" }, { sessionPresetId: "creator-a" });
	const [a, b] = await Promise.all([
		controller.command({ type: "panel.snapshot" }, { sessionPresetId: "creator-a" }),
		controller.command({ type: "panel.snapshot" }, { sessionPresetId: "creator-b" }),
	]);
	assert.equal(a.sessionPresetId, "creator-a");
	assert.equal(b.sessionPresetId, "creator-b");
	assert.equal(service.getSnapshot().sessionPresetId, null);
	assert.equal(service.getSnapshot().target.id, "editable");
});

test("fresh-session Test returns an explicit handoff without recomposing current session", async () => {
	const { controller } = harness();
	await controller.command({ type: "target.open", targetId: "editable" }, { sessionPresetId: "creator" });
	const panel = await controller.command({ type: "test.start", targetId: "editable" }, { sessionPresetId: "creator" });
	assert.deepEqual(panel.test.value, { kind: "fresh-session-required", presetId: "editable", launched: false, currentSessionUnchanged: true, message: "Create a new DSH session with this preset" });
	assert.equal(panel.sessionPresetId, "creator");
});
