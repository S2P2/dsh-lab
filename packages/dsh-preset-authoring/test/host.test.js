import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { Readable } from "node:stream";
import {
	apply,
	createHostAdapters,
	createPresetTree,
	decodePresetText,
	materializePresetDirectory,
	readPresetDirectory,
	restorePresetDirectory,
	serviceName,
} from "../src/index.js";

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "dsh-preset-authoring-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

async function put(path, content) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

test("host plugin provides one disposable shared draft service", () => {
	let provided;
	const dispose = () => {};
	const returned = apply({
		provide(name, value) {
			provided = { name, value };
			return dispose;
		},
	}, { adapters: { async listTargets() { return []; } } });

	assert.equal(provided.name, serviceName);
	assert.equal(typeof provided.value.dispatch, "function");
	assert.equal(typeof provided.value.getSnapshot, "function");
	assert.equal(returned, dispose);
});

test("default activation provides the complete shared service and a disposable exact route", async (t) => {
	const root = await fixture(t);
	let route;
	let routeDisposed = false;
	let cleanup;
	const serviceDispose = () => {};
	let inspectedSession;
	const ctx = {
		agentPresets: { roots: [{ path: root, trust: "user" }], async list() { return []; } },
		get(name) {
			assert.equal(name, "sessionController");
			return { async inspect(id) { inspectedSession = id; return { meta: { agentPreset: "creator" } }; } };
		},
		provide(name, value) { this[name] = value; return serviceDispose; },
		inject(names, callback) {
			assert.deepEqual(names, ["webServer"]);
			callback({
				webServer: { register(descriptor) { route = descriptor; return () => { routeDisposed = true; }; } },
				effect(factory) { cleanup = factory(); },
			});
		},
	};
	assert.equal(apply(ctx), serviceDispose);
	assert.equal(ctx.presetAuthoringDrafts.getSnapshot().inspection.status, "idle");
	assert.deepEqual({ kind: route.kind, path: route.path }, { kind: "exact", path: "/dsh-preset-authoring/api" });
	const request = Readable.from([JSON.stringify({ sessionId: "s1", command: { type: "panel.snapshot" } })]);
	request.method = "POST";
	request.headers = { host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" };
	request.socket = {};
	let responseBody = "";
	await route.handler(request, { writeHead() {}, end(value) { responseBody = value; } });
	assert.equal(JSON.parse(responseBody).value.sessionPresetId, "creator");
	assert.equal(inspectedSession, "s1");
	cleanup();
	assert.equal(routeDisposed, true);
});

test("DSH roster paths, not trust labels, decide which target is editable", async (t) => {
	const base = await fixture(t);
	const writableRoot = join(base, "first-user");
	const laterUserRoot = join(base, "later-user");
	const systemRoot = join(base, "system");
	const outside = join(base, "outside");
	for (const [root, id] of [[writableRoot, "editable"], [laterUserRoot, "later"], [systemRoot, "system"], [outside, "escaped"]]) {
		await put(join(root, id, "agent.cordis.yml"), `- name: ${id}\n`);
	}
	await mkdir(join(writableRoot, "link"), { recursive: true });
	await symlink(join(outside, "escaped", "agent.cordis.yml"), join(writableRoot, "link", "agent.cordis.yml"));

	const rows = [
		{ id: "editable", trust: "system", path: join(writableRoot, "editable", "agent.cordis.yml") },
		{ id: "later", trust: "user", path: join(laterUserRoot, "later", "agent.cordis.yml") },
		{ id: "system", trust: "user", path: join(systemRoot, "system", "agent.cordis.yml") },
		{ id: "escaped", trust: "user", path: join(writableRoot, "link", "agent.cordis.yml") },
	];
	const dsh = {
		roots: [
			{ path: systemRoot, trust: "system" },
			{ path: writableRoot, trust: "user" },
			{ path: laterUserRoot, trust: "user" },
		],
		async list() { return rows; },
		async resolve(id) { return rows.find((row) => row.id === id); },
	};

	const adapters = createHostAdapters(dsh);
	const roster = await adapters.listTargets();
	assert.equal(roster.some((target) => "path" in target), false, "Host paths stay out of roster projections");
	assert.deepEqual(roster.map(({ id, editable }) => [id, editable]), [
		["editable", true],
		["later", false],
		["system", false],
		["escaped", false],
	]);
	await assert.rejects(() => adapters.materializeTarget("later", []), /not in the writable preset root/);
	await assert.rejects(() => adapters.materializeTarget("system", []), /not in the writable preset root/);
});

test("native copy is followed by a fresh authoritative resolve", async (t) => {
	const root = await fixture(t);
	await mkdir(root, { recursive: true });
	let copied = false;
	let resolves = 0;
	const copiedPath = join(root, "copy", "agent.cordis.yml");
	const dsh = {
		roots: [{ path: root, trust: "user" }],
		async copy(from, id, name) {
			assert.deepEqual([from, id, name], ["standard", "copy", "My Copy"]);
			copied = true;
			await put(copiedPath, "- name: copied\n");
		},
		async resolve(id) {
			resolves++;
			assert.equal(copied, true, "resolve happens after copy completes");
			return { id, trust: "user", path: copiedPath };
		},
	};

	const copiedTarget = await createHostAdapters(dsh).copyTarget("standard", "copy", "My Copy");
	assert.equal(resolves, 1);
	assert.equal(copiedTarget.id, "copy");
	assert.equal(copiedTarget.editable, true);
	assert.equal(new TextDecoder().decode(copiedTarget.files[0].content), "- name: copied\n");
});

test("complete-directory helpers materialize and restore nested binary trees", async (t) => {
	const root = await fixture(t);
	const target = join(root, "target");
	await put(join(target, "agent.cordis.yml"), "- name: original\n");
	await put(join(target, "skills", "old.md"), "old");
	const original = await readPresetDirectory(target);
	const candidate = createPresetTree([
		{ path: "agent.cordis.yml", content: new TextEncoder().encode("- name: candidate\n") },
		{ path: "assets/data.bin", content: new Uint8Array([0, 255, 4]) },
	]);

	await materializePresetDirectory(target, candidate);
	assert.deepEqual((await readPresetDirectory(target)).map((file) => file.path), ["agent.cordis.yml", "assets/data.bin"]);
	assert.deepEqual([...await readFile(join(target, "assets/data.bin"))], [0, 255, 4]);
	await restorePresetDirectory(target, original);
	assert.deepEqual((await readPresetDirectory(target)).map((file) => file.path), ["agent.cordis.yml", "skills/old.md"]);
	assert.equal(await readFile(join(target, "skills/old.md"), "utf8"), "old");

	await assert.rejects(
		materializePresetDirectory(target, [{ path: "../escape", content: "" }]),
		/unsafe preset file path/,
	);
	assert.equal(await readFile(join(target, "agent.cordis.yml"), "utf8"), "- name: original\n");
	assert.equal(await readFile(join(target, "skills/old.md"), "utf8"), "old");
});

test("materialization keeps the completed swap when backup cleanup partially fails", async (t) => {
	const root = await fixture(t);
	const target = join(root, "target");
	await put(join(target, "agent.cordis.yml"), "- name: original\n");
	await put(join(target, "skills", "old.md"), "old");
	const candidate = createPresetTree([{ path: "agent.cordis.yml", content: "- name: candidate\n" }]);
	let injected = false;

	await materializePresetDirectory(target, candidate, {
		async remove(path, options) {
			if (!injected && path.includes(".backup-")) {
				injected = true;
				await rm(join(path, "skills"), { recursive: true });
				throw new Error("backup cleanup failed after partial removal");
			}
			return rm(path, options);
		},
	});
	assert.equal(injected, true);
	assert.equal(await readFile(join(target, "agent.cordis.yml"), "utf8"), "- name: candidate\n");
});

test("mount materializes the candidate, calls standingKeyFor(targetId), restores, and rethrows the exact error", async (t) => {
	const root = await fixture(t);
	const targetDir = join(root, "target");
	const composition = join(targetDir, "agent.cordis.yml");
	await put(composition, "- name: saved\n");
	const failure = Object.assign(new Error("real DSH diagnostic"), { code: "agent-preset/invalid" });
	const calls = [];
	const dsh = {
		roots: [{ path: root, trust: "user" }],
		async resolve(id) { return { id, trust: "user", path: composition }; },
		async standingKeyFor(id) {
			calls.push(id);
			assert.equal(await readFile(composition, "utf8"), "- name: candidate\n");
			throw failure;
		},
	};
	const adapters = createHostAdapters(dsh);
	const source = await adapters.readTarget("target");
	const draft = createPresetTree([{ path: "agent.cordis.yml", content: "- name: candidate\n" }]);

	await assert.rejects(
		adapters.mount({ target: { id: "target" }, source: { tree: createPresetTree(source.files) }, draft: { tree: draft } }),
		(error) => error === failure,
	);
	assert.deepEqual(calls, ["target"]);
	assert.equal(await readFile(composition, "utf8"), "- name: saved\n");
});

test("a restore failure is attached without replacing the exact DSH mount error", async (t) => {
	const root = await fixture(t);
	const composition = join(root, "target", "agent.cordis.yml");
	await put(composition, "- name: saved\n");
	const failure = new Error("mount failed");
	const adapters = createHostAdapters({
		roots: [{ path: root, trust: "user" }],
		async resolve(id) { return { id, trust: "user", path: composition }; },
		async standingKeyFor() { throw failure; },
	});

	await assert.rejects(
		adapters.mount({
			target: { id: "target" },
			source: { tree: [{ path: "../cannot-restore", content: "" }] },
			draft: { tree: createPresetTree([{ path: "agent.cordis.yml", content: "- name: candidate\n" }]) },
		}),
		(error) => error === failure && error.restoreError?.message.includes("unsafe preset file path"),
	);
});
