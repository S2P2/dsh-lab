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

test("successful Apply commits only selected target and advances the shared draft", async (t) => {
	const { root, flow } = await fixture(t);
	await flow.git.ensureBaseline();
	await flow.service.dispatch({ type: COMMAND.PUT_FILE, path: "skills/new.md", content: "new" });
	await writeFile(join(root, "unrelated.txt"), "dirty");
	await flow.service.dispatch({ type: COMMAND.APPLY });
	const state = flow.service.getSnapshot();
	assert.equal(state.apply.status, "ready");
	assert.equal(state.apply.value.saved, true);
	assert.equal(state.stale, false);
	assert.equal(state.source.fingerprint, state.draft.fingerprint);
	const { stdout: committed } = await exec("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: root });
	assert.match(committed, /target\/skills\/new.md/);
	assert.doesNotMatch(committed, /unrelated.txt/);
	const { stdout: dirty } = await exec("git", ["status", "--short", "--", "unrelated.txt"], { cwd: root });
	assert.match(dirty, / M unrelated.txt/);
});

test("failed authoritative mount restores committed whole target and retains exact failed candidate", async (t) => {
	const { root, flow, fail } = await fixture(t);
	await flow.service.dispatch({ type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "broken" });
	await flow.service.dispatch({ type: COMMAND.DELETE_FILE, path: "skills/old.md" });
	const error = Object.assign(new Error("exact DSH mount diagnostic"), { code: "agent-preset/invalid" });
	fail(error);
	await assert.rejects(flow.service.dispatch({ type: COMMAND.APPLY }), (caught) => caught === error);
	assert.equal(await readFile(join(root, "target", "agent.cordis.yml"), "utf8"), "- id: ok\n  name: valid\n");
	assert.equal(await readFile(join(root, "target", "skills", "old.md"), "utf8"), "old");
	assert.equal(flow.service.getSnapshot().apply.diagnostic.message, "exact DSH mount diagnostic");
	assert.match(JSON.stringify(flow.service.getSnapshot().draft.tree), /YnJva2Vu|broken/);
});

test("manual history restore replaces the whole target directory and reopens the shared draft", async (t) => {
	const { root, flow } = await fixture(t);
	const original = (await flow.git.ensureBaseline()).revision;
	await flow.service.dispatch({ type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "changed" });
	await flow.service.dispatch({ type: COMMAND.DELETE_FILE, path: "skills/old.md" });
	await flow.service.dispatch({ type: COMMAND.PUT_FILE, path: "assets/new.txt", content: "new" });
	await flow.service.dispatch({ type: COMMAND.APPLY });
	await flow.service.dispatch({ type: COMMAND.RESTORE_HISTORY, revision: original });
	assert.equal(await readFile(join(root, "target", "skills", "old.md"), "utf8"), "old");
	await assert.rejects(readFile(join(root, "target", "assets", "new.txt")), /ENOENT/);
	assert.equal(flow.service.getSnapshot().source.fingerprint, flow.service.getSnapshot().draft.fingerprint);
});
