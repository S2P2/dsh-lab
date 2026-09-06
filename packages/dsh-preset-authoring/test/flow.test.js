import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { PRESET_DRAFT_COMMANDS as COMMAND, createHostPresetAuthoring } from "../src/index.js";

const exec = promisify(execFile);
async function put(path, content) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); }
function guarded(service, command) {
	const state = service.getSnapshot();
	return service.dispatch({ ...command, targetId: state.target.id, expectedRevision: state.revision, expectedSourceFingerprint: state.source.fingerprint, expectedDraftFingerprint: state.draft.fingerprint });
}
async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "dsh-preset-flow-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await put(join(root, "target", "agent.cordis.yml"), "- id: ok\n  name: valid\n");
	await put(join(root, "target", "skills", "old.md"), "old");
	await put(join(root, "unrelated.txt"), "initial");
	const preset = { id: "target", trust: "user", path: join(root, "target", "agent.cordis.yml") };
	let failure = null;
	const agentPresets = {
		roots: [{ path: root, trust: "user" }],
		async list() { return [preset]; },
		async resolve(id) { assert.equal(id, "target"); return preset; },
		async standingKeyFor() { if (failure) throw failure; return { agentPreset: "target" }; },
	};
	const flow = createHostPresetAuthoring(agentPresets);
	await flow.service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	return { root, flow, fail(error) { failure = error; } };
}

test("first successful Apply baselines and commits only the selected target", async (t) => {
	const { root, flow } = await fixture(t);
	await guarded(flow.service, { type: COMMAND.PUT_FILE, path: "skills/new.md", content: "new" });
	await writeFile(join(root, "unrelated.txt"), "dirty");
	await guarded(flow.service, { type: COMMAND.APPLY });
	const state = flow.service.getSnapshot();
	assert.equal(state.apply.status, "ready");
	assert.equal(state.apply.value.saved, true);
	assert.equal(state.stale, false);
	assert.equal(state.source.fingerprint, state.draft.fingerprint);
	const { stdout: committed } = await exec("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: root });
	assert.match(committed, /target\/skills\/new.md/);
	assert.doesNotMatch(committed, /unrelated.txt/);
	const { stdout: dirty } = await exec("git", ["status", "--short", "--", "unrelated.txt"], { cwd: root });
	assert.match(dirty, /\?\? unrelated.txt/);
	assert.equal(await readFile(join(root, "unrelated.txt"), "utf8"), "dirty");
});

test("failed authoritative mount restores committed whole target and retains exact failed candidate", async (t) => {
	const { root, flow, fail } = await fixture(t);
	await guarded(flow.service, { type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "broken" });
	await guarded(flow.service, { type: COMMAND.DELETE_FILE, path: "skills/old.md" });
	const error = Object.assign(new Error("exact DSH mount diagnostic"), { code: "agent-preset/invalid" });
	fail(error);
	await assert.rejects(guarded(flow.service, { type: COMMAND.APPLY }), (caught) => caught === error);
	assert.equal(await readFile(join(root, "target", "agent.cordis.yml"), "utf8"), "- id: ok\n  name: valid\n");
	assert.equal(await readFile(join(root, "target", "skills", "old.md"), "utf8"), "old");
	assert.equal(flow.service.getSnapshot().apply.diagnostic.message, "exact DSH mount diagnostic");
	assert.match(JSON.stringify(flow.service.getSnapshot().draft.tree), /YnJva2Vu|broken/);
});

test("failed Git recovery falls back to the captured whole source tree", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "dsh-preset-fallback-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const composition = join(root, "target", "agent.cordis.yml");
	await put(composition, "saved");
	const failure = new Error("exact mount failure");
	const preset = { id: "target", trust: "user", path: composition };
	const locked = {
		async ensureTargetBaseline() { return { status: "ready", revision: "head" }; },
		async recordHead() { return { status: "ready", revision: "head" }; },
		async restoreTarget() { return { status: "degraded", operation: "restoreTarget", diagnostic: { message: "git restore failed" } }; },
	};
	const git = { root, withRootLock: (operation) => operation(locked) };
	const flow = createHostPresetAuthoring({
		roots: [{ path: root, trust: "user" }],
		async list() { return [preset]; },
		async resolve() { return preset; },
		async standingKeyFor() { throw failure; },
	}, { git });
	await flow.service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await guarded(flow.service, { type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "broken" });
	await assert.rejects(guarded(flow.service, { type: COMMAND.APPLY }), (error) => error === failure && error.recovery.status === "degraded");
	assert.equal(await readFile(composition, "utf8"), "saved");
});

test("manual history restore replaces the whole target directory and reopens the shared draft", async (t) => {
	const { root, flow } = await fixture(t);
	const original = (await flow.git.ensureBaseline()).revision;
	await guarded(flow.service, { type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "changed" });
	await guarded(flow.service, { type: COMMAND.DELETE_FILE, path: "skills/old.md" });
	await guarded(flow.service, { type: COMMAND.PUT_FILE, path: "assets/new.txt", content: "new" });
	await guarded(flow.service, { type: COMMAND.APPLY });
	await guarded(flow.service, { type: COMMAND.RESTORE_HISTORY, revision: original });
	assert.equal(await readFile(join(root, "target", "skills", "old.md"), "utf8"), "old");
	await assert.rejects(readFile(join(root, "target", "assets", "new.txt")), /ENOENT/);
	assert.equal(flow.service.getSnapshot().source.fingerprint, flow.service.getSnapshot().draft.fingerprint);
});

function recoveryFlow({ fallbackFails = false } = {}) {
	let files = [{ path: "agent.cordis.yml", content: "saved" }];
	let committed = false;
	const host = {
		editableRoot() { return "/unused"; },
		async listTargets() { return [{ id: "target", editable: true }]; },
		async readTarget() { return { id: "target", editable: true, files }; },
		async gitTarget() { return "target"; },
		async materializeTarget(id, tree) { files = tree.map((file) => ({ path: file.path, content: Buffer.from(file.content, "base64") })); },
		async validateMaterializedTarget() { throw new Error("mount rejected candidate"); },
		async restoreTarget(id, tree) { if (fallbackFails) throw new Error("fallback failed /secret/path"); files = tree.map((file) => ({ path: file.path, content: Buffer.from(file.content, "base64") })); },
	};
	const locked = {
		async ensureTargetBaseline() { return { status: "ready" }; },
		async recordHead() { return { status: "ready", revision: "before" }; },
		async restoreTarget() { return { status: "degraded", diagnostic: { message: "git failed /secret/path" } }; },
		async commitTarget() { committed = true; },
	};
	const flow = createHostPresetAuthoring(null, { host, git: { withRootLock: (operation) => operation(locked) } });
	return { flow, files: () => files, committed: () => committed };
}

test("mount validation recovers through captured source without committing candidate", async () => {
	const fixture = recoveryFlow();
	await fixture.flow.service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await guarded(fixture.flow.service, { type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "candidate" });
	await assert.rejects(guarded(fixture.flow.service, { type: COMMAND.VALIDATE_MOUNT }), /mount rejected candidate/);
	assert.equal(Buffer.from(fixture.files()[0].content, "base64").toString("utf8"), "saved");
	assert.equal(fixture.committed(), false);
	assert.deepEqual(fixture.flow.service.getSnapshot().mount.diagnostic, {
		message: "mount rejected candidate",
		recovery: { status: "degraded" },
		fallbackRecovery: { status: "ready" },
		recoveryState: "recovered-via-fallback",
	});
});

test("mount validation exposes fatal unrecovered state when both restores fail", async () => {
	const fixture = recoveryFlow({ fallbackFails: true });
	await fixture.flow.service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await guarded(fixture.flow.service, { type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "candidate" });
	await assert.rejects(guarded(fixture.flow.service, { type: COMMAND.VALIDATE_MOUNT }), (error) => error.code === "PRESET_VALIDATION_UNRECOVERED");
	const diagnostic = fixture.flow.service.getSnapshot().mount.diagnostic;
	assert.equal(diagnostic.recoveryState, "unrecovered");
	assert.deepEqual(diagnostic.fallbackRecovery, { status: "failed" });
	assert.equal(JSON.stringify(diagnostic).includes("/secret/path"), false);
	assert.equal(Buffer.from(fixture.files()[0].content, "base64").toString("utf8"), "candidate");
});
