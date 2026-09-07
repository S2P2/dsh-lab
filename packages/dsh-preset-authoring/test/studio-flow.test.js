import assert from "node:assert/strict";
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { PRESET_DRAFT_COMMANDS as COMMAND, createHostPresetAuthoring } from "../src/index.js";

const exec = promisify(execFile);

async function put(path, content) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

function guarded(service, command) {
	const state = service.getSnapshot();
	return service.dispatch({ ...command, targetId: state.target.id, expectedRevision: state.revision, expectedSourceFingerprint: state.source.fingerprint, expectedDraftFingerprint: state.draft.fingerprint });
}

/**
 * A full authoring flow over a custom, non-default preset layout: the user
 * root is a fresh tmpdir (never `~/.dsh`), a shipped/system root sits beside
 * it, and every roster/resolve/copy/standingKeyFor call goes through a DSH
 * `agentPresets` service shape. The controller, studio presenter, shared
 * draft, safe-write boundary, and real local Git adapter are all the shipped
 * ones — only the DSH service is faked, at its real seam.
 */
async function customRootFixture(t) {
	const base = await mkdtemp(join(tmpdir(), "dsh-preset-studio-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const userRoot = join(base, "user-presets");
	const systemRoot = join(base, "shipped-presets");
	await put(join(userRoot, "worker", "agent.cordis.yml"), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: hello\n");
	await put(join(systemRoot, "shipped", "agent.cordis.yml"), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n");
	await put(join(userRoot, "unrelated.txt"), "keep me dirty\n");

	const installed = new Map([
		["worker", { id: "worker", trust: "user", name: "Worker", path: join(userRoot, "worker", "agent.cordis.yml") }],
		["shipped", { id: "shipped", trust: "system", name: "Shipped", path: join(systemRoot, "shipped", "agent.cordis.yml") }],
	]);
	const agentPresets = {
		roots: [
			{ path: systemRoot, trust: "system" },
			{ path: userRoot, trust: "user" },
		],
		async list() { return [...installed.values()]; },
		async resolve(id) {
			const record = installed.get(id);
			if (!record) throw new Error(`unknown preset: ${id}`);
			return record;
		},
		async copy(from, id, name) {
			assert.ok(installed.has(from), "copy source resolves through the DSH service");
			await cp(dirname(installed.get(from).path), join(userRoot, id), { recursive: true });
			installed.set(id, { id, trust: "user", ...(name === undefined ? {} : { name }), path: join(userRoot, id, "agent.cordis.yml") });
		},
		async standingKeyFor(id) { return { agentPreset: id }; },
	};
	const flow = createHostPresetAuthoring(agentPresets);
	return { base, userRoot, systemRoot, flow };
}

test("studio drives roster, open, edit, and Apply end to end at a custom non-default preset root", async (t) => {
	const { userRoot, flow } = await customRootFixture(t);

	const roster = await flow.controller.command({ type: "panel.snapshot" }, { sessionPresetId: "custom-creator" });
	assert.deepEqual(roster.targets.map(({ id, editable, trust }) => [id, editable, trust]), [
		["worker", true, "user"],
		["shipped", false, "system"],
	], "editability follows containment of the custom user root, not trust labels");
	assert.equal(JSON.stringify(roster).includes(".dsh"), false, "no default ~/.dsh path leaks into the panel");
	assert.equal(JSON.stringify(roster).includes(homedir()), false, "no home-directory path leaks into the panel");
	assert.equal(roster.sessionPresetId, "custom-creator");

	let view = await flow.controller.command({ type: "target.open", targetId: "worker" });
	const send = (type, extra = {}) => flow.controller.command({
		type,
		...extra,
		targetId: view.target.id,
		expectedRevision: view.revision,
		expectedSourceFingerprint: view.sourceFingerprint,
		expectedDraftFingerprint: view.draftFingerprint,
	});

	// studio edit: the generic row tree, serialized and persisted Host-side
	const editor = view.composition.editor.map((row) => ({ ...row, children: [...(row.children || [])] }));
	editor.find((row) => row.id === "persona").configText = "text: rewritten";
	view = await send("draft.putRows", { rows: editor });
	assert.notEqual(view.draftFingerprint, view.sourceFingerprint);
	assert.match(view.composition.draft, /text: rewritten/);
	assert.equal(view.composition.source.includes("text: rewritten"), false, "the saved target is untouched until Apply");
	assert.equal(await readFile(join(userRoot, "worker", "agent.cordis.yml"), "utf8").then((text) => text.includes("rewritten")), false);

	view = await send("draft.apply");
	assert.equal(view.apply.status, "ready");
	assert.equal(view.apply.value.saved, true);
	assert.equal(view.stale, false);
	assert.equal(view.sourceFingerprint, view.draftFingerprint, "source adopts the applied revision");
	assert.match(await readFile(join(userRoot, "worker", "agent.cordis.yml"), "utf8"), /text: rewritten/);

	const { stdout: committed } = await exec("git", ["log", "--format=%s", "--", "worker"], { cwd: userRoot });
	assert.match(committed, /Apply preset worker/);
	const { stdout: dirty } = await exec("git", ["status", "--short", "--", "unrelated.txt"], { cwd: userRoot });
	assert.match(dirty, /\?\? unrelated.txt/, "unrelated files stay untracked");
});

test("copy-first through the studio lands editable copies in the custom user root only", async (t) => {
	const { userRoot, systemRoot, flow } = await customRootFixture(t);
	const original = await readFile(join(systemRoot, "shipped", "agent.cordis.yml"), "utf8");

	let view = await flow.controller.command({ type: "target.open", targetId: "shipped" });
	assert.equal(view.target.editable, false);

	view = await flow.controller.command({ type: "target.copy", sourceId: "shipped", targetId: "shipped-copy", name: "Shipped Copy" });
	assert.equal(view.target.id, "shipped-copy");
	assert.equal(view.target.editable, true, "the copy is editable through containment in the custom user root");
	assert.equal(view.sessionPresetId, null, "copying never rewrites the session preset");

	// the editable copy opens and edits through the same studio write path
	const send = (type, extra = {}) => flow.controller.command({
		type,
		...extra,
		targetId: view.target.id,
		expectedRevision: view.revision,
		expectedSourceFingerprint: view.sourceFingerprint,
		expectedDraftFingerprint: view.draftFingerprint,
	});
	const editor = view.composition.editor.map((row) => ({ ...row, children: [...(row.children || [])] }));
	editor.find((row) => row.id === "persona").configText = "text: forked";
	view = await send("draft.putRows", { rows: editor });
	view = await send("draft.apply");
	assert.equal(view.apply.value.saved, true);
	assert.match(await readFile(join(userRoot, "shipped-copy", "agent.cordis.yml"), "utf8"), /text: forked/);
	assert.equal(await readFile(join(systemRoot, "shipped", "agent.cordis.yml"), "utf8"), original, "the system original stays byte-identical");
});

test("a preset changed on disk while drafting blocks Apply as stale, and reopening adopts the saved target", async (t) => {
	const { userRoot, flow } = await customRootFixture(t);
	let view = await flow.controller.command({ type: "target.open", targetId: "worker" });
	await writeFile(join(userRoot, "worker", "agent.cordis.yml"), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: externally changed\n");

	const send = (type, extra = {}) => flow.controller.command({
		type,
		...extra,
		targetId: view.target.id,
		expectedRevision: view.revision,
		expectedSourceFingerprint: view.sourceFingerprint,
		expectedDraftFingerprint: view.draftFingerprint,
	});
	await assert.rejects(send("draft.apply"), (error) => error.code === "STALE_PRESET_DRAFT");
	view = await flow.controller.command({ type: "panel.snapshot" });
	assert.equal(view.stale, true, "the refused Apply leaves the stale banner state in the snapshot");
	await assert.rejects(access(join(userRoot, ".git")), /ENOENT/, "the stale Apply never even initializes the Git root");

	// the stale banner's reopen action re-reads the saved target as a fresh draft
	view = await flow.controller.command({ type: "target.open", targetId: "worker" });
	assert.equal(view.stale, false);
	assert.match(view.composition.draft, /externally changed/);
	assert.equal(view.sourceFingerprint, view.draftFingerprint);
});

test("Apply re-checks the saved target under the root lock and refuses stale drafts before any write", async () => {
	const savedFiles = [{ path: "agent.cordis.yml", content: "- name: saved\n" }];
	let reads = 0;
	let materialized = 0;
	let committed = 0;
	const host = {
		editableRoot() { return "/unused"; },
		async listTargets() { return [{ id: "target", editable: true }]; },
		async readTarget() {
			reads += 1;
			// open (1) and the domain pre-check (2) see the captured source;
			// the flow's under-lock re-read (3) sees a target that changed on
			// disk while the draft was open.
			return { id: "target", editable: true, files: reads < 3 ? savedFiles : [{ path: "agent.cordis.yml", content: "- name: changed-on-disk\n" }] };
		},
		async gitTarget() { return "target"; },
		async materializeTarget() { materialized += 1; },
		async validateMaterializedTarget() { return { standingKey: "target" }; },
		async restoreTarget() {},
	};
	const locked = {
		async ensureTargetBaseline() { return { status: "ready" }; },
		async recordHead() { return { status: "ready", revision: "head" }; },
		async commitTarget() { committed += 1; return { status: "ready", revision: "r1" }; },
		async restoreTarget() { return { status: "ready" }; },
	};
	const flow = createHostPresetAuthoring(null, { host, git: { root: "/unused", withRootLock: (operation) => operation(locked) } });

	await flow.service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: "target" });
	await guarded(flow.service, { type: COMMAND.PUT_FILE, path: "agent.cordis.yml", content: "- name: candidate\n" });
	await assert.rejects(
		guarded(flow.service, { type: COMMAND.APPLY }),
		(error) => error.code === "STALE_PRESET_DRAFT",
	);
	assert.equal(materialized, 0, "a stale candidate never reaches the target directory");
	assert.equal(committed, 0, "nothing is committed");
	assert.equal(Buffer.from(flow.service.getSnapshot().draft.tree[0].content, "base64").toString("utf8"), "- name: candidate\n", "the refused candidate stays in the shared draft");
});
