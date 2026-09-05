import assert from "node:assert/strict";
import { test } from "node:test";
import {
	PRESET_DRAFT_COMMANDS as COMMAND,
	createPresetDraftService,
	decodePresetText,
} from "../src/index.js";

function memoryTargets(initial) {
	const targets = new Map(Object.entries(initial));
	return {
		targets,
		async readTarget(id) {
			const value = targets.get(id);
			if (!value) throw new Error(`unknown target: ${id}`);
			return { id, editable: value.editable, revision: value.revision, files: value.files };
		},
	};
}

const targetFiles = [{ path: "agent.cordis.yml", content: "name: target\n" }];

test("session identity and selected target remain independent", async () => {
	const memory = memoryTargets({ target: { editable: true, revision: "r1", files: targetFiles } });
	const service = createPresetDraftService(memory);
	await service.dispatch({ type: COMMAND.SET_SESSION, presetId: "custom-creator" });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.SET_SESSION, presetId: "another-session-preset" });

	const state = service.getSnapshot();
	assert.equal(state.sessionPresetId, "another-session-preset");
	assert.equal(state.target.id, "target");
	assert.equal(state.target.editable, true);
	assert.equal(state.source.fingerprint, state.draft.fingerprint);
});

test("human and bridge callers observe one shared complete-directory draft", async () => {
	const memory = memoryTargets({ target: { editable: true, files: targetFiles } });
	const service = createPresetDraftService(memory);
	const observed = [];
	const unsubscribe = service.subscribe((state) => observed.push(state));
	const bridge = service;

	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.PUT_FILE, path: "skills/local/SKILL.md", content: "local skill" });
	await bridge.dispatch({ type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "name: changed\n" });
	unsubscribe();

	const files = service.getSnapshot().draft.tree;
	assert.deepEqual(files.map((file) => file.path), ["agent.cordis.yml", "skills/local/SKILL.md"]);
	assert.equal(decodePresetText(files[0]), "name: changed\n");
	assert.equal(decodePresetText(files[1]), "local skill");
	assert.equal(observed.at(-1).draft.fingerprint, service.getSnapshot().draft.fingerprint);
});

test("saved whole-tree changes mark a draft stale and block apply", async () => {
	const memory = memoryTargets({ target: { editable: true, revision: "r1", files: targetFiles } });
	let applied = 0;
	const service = createPresetDraftService({
		...memory,
		async apply() { applied++; },
	});
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.PUT_FILE, path: "preset.yml", content: "title: candidate\n" });
	memory.targets.set("target", {
		editable: true,
		revision: "r2",
		files: [...targetFiles, { path: "skills/new/SKILL.md", content: "external change" }],
	});

	await assert.rejects(
		service.dispatch({ type: COMMAND.APPLY }),
		(error) => error.code === "STALE_PRESET_DRAFT",
	);
	const state = service.getSnapshot();
	assert.equal(state.stale, true);
	assert.equal(state.apply.status, "blocked");
	assert.equal(applied, 0);
	assert.equal(state.draft.tree.some((file) => file.path === "preset.yml"), true, "candidate remains intact");
});

test("stable lifecycle slots delegate without embedding Git or mount internals", async () => {
	const memory = memoryTargets({ target: { editable: true, files: targetFiles } });
	const calls = [];
	const service = createPresetDraftService({
		...memory,
		semanticDiff(input) { calls.push("semanticDiff"); return { changed: input.draft.fingerprint !== input.source.fingerprint }; },
		rawDiff() { calls.push("rawDiff"); return "raw patch"; },
		preflight() { calls.push("preflight"); return { diagnostics: [] }; },
		mount() { calls.push("mount"); return { standingKey: "preset:key" }; },
		apply() { calls.push("apply"); return { revision: "commit-placeholder" }; },
		history() { calls.push("history"); return [{ revision: "r1" }]; },
	});
	const initial = service.getSnapshot();
	for (const field of ["semanticDiff", "rawDiff", "preflight", "mount", "apply", "history"]) {
		assert.ok(field in initial);
	}

	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.PUT_FILE, path: "preset.yml", content: "title: draft\n" });
	await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });
	await service.dispatch({ type: COMMAND.VALIDATE_MOUNT });
	await service.dispatch({ type: COMMAND.APPLY });
	await service.dispatch({ type: COMMAND.LOAD_HISTORY });

	assert.deepEqual(calls, ["semanticDiff", "rawDiff", "preflight", "mount", "apply", "history"]);
	const state = service.getSnapshot();
	assert.equal(state.semanticDiff.value.changed, true);
	assert.equal(state.rawDiff.value, "raw patch");
	assert.deepEqual(state.preflight.value, { diagnostics: [] });
	assert.equal(state.mount.value.standingKey, "preset:key");
	assert.equal(state.apply.value.revision, "commit-placeholder");
	assert.deepEqual(state.history.value, [{ revision: "r1" }]);
});

test("read-only targets can be inspected but not changed or applied", async () => {
	const memory = memoryTargets({ system: { editable: false, files: targetFiles } });
	let applied = 0;
	const service = createPresetDraftService({ ...memory, apply() { applied++; } });
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "system" });

	await assert.rejects(
		service.dispatch({ type: COMMAND.PUT_FILE, path: "preset.yml", content: "title: no\n" }),
		(error) => error.code === "READ_ONLY_PRESET_TARGET",
	);
	await assert.rejects(
		service.dispatch({ type: COMMAND.APPLY }),
		(error) => error.code === "READ_ONLY_PRESET_TARGET",
	);
	assert.equal(applied, 0);
	assert.equal(service.getSnapshot().target.editable, false);
});

test("unconfigured future adapter seams remain explicit", async () => {
	const memory = memoryTargets({ target: { editable: false, files: targetFiles } });
	const service = createPresetDraftService(memory);
	await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });

	const state = service.getSnapshot();
	for (const field of ["semanticDiff", "rawDiff", "preflight", "mount", "apply", "history"]) {
		assert.equal(state[field].status, "unavailable");
	}
});
