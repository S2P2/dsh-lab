import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
	createPresetAuthoringController,
	createPresetAuthoringRoute,
	createHostAdapters,
	createPresetDraftService,
	createPresetStudioPresenter,
} from "../src/index.js";

const wireEntries = [
	{ entryId: "persona", moduleName: "@deepseek-ai/dsh-persona", enabled: true, fiberPhase: "active" },
	{ entryId: "bash", moduleName: "@deepseek-ai/dsh-tool-bash", enabled: true, fiberPhase: null },
	{ entryId: "group", moduleName: "cordis:group", enabled: false, fiberPhase: "ready" },
];

async function request(handler, body) {
	const req = Readable.from([JSON.stringify(body)]);
	req.method = "POST";
	req.headers = { host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" };
	req.socket = {};
	let status;
	let text = "";
	const res = { writeHead(value) { status = value; }, end(value = "") { text += value; } };
	await handler(req, res);
	return { status, body: JSON.parse(text) };
}

function controllerWith(pluginInventory) {
	const targets = new Map([
		["editable", { id: "editable", editable: true, files: [{ path: "agent.cordis.yml", content: "- name: pkg\n" }] }],
	]);
	const host = {
		async listTargets() { return [...targets.values()].map(({ files, ...target }) => target); },
		async readTarget(id) { return targets.get(id); },
		...createHostAdapters({ async list() { return []; }, async resolve() { throw new Error("unused"); } }, { pluginInventory }),
	};
	const service = createPresetDraftService(host);
	return createPresetAuthoringController({ service, host, presenter: createPresetStudioPresenter() });
}

test("inventory.list serves normalized installed-module entries through the real controller and route", async () => {
	const pluginInventory = { async list() { return { entries: wireEntries }; } };
	const route = createPresetAuthoringRoute(controllerWith(pluginInventory));
	const response = await request(route, { sessionId: "s1", command: { type: "inventory.list" } });
	assert.equal(response.status, 200);
	assert.deepEqual(response.body.value.entries, [
		{ entryId: "persona", moduleName: "@deepseek-ai/dsh-persona", enabled: true, fiberPhase: "active" },
		{ entryId: "bash", moduleName: "@deepseek-ai/dsh-tool-bash", enabled: true, fiberPhase: null },
		{ entryId: "group", moduleName: "cordis:group", enabled: false, fiberPhase: "ready" },
	]);
});

test("the host adapter accepts the upstream bare-array wire form and drops unusable entries", async () => {
	const pluginInventory = {
		async list() {
			return [
				wireEntries[0],
				{ moduleName: "@deepseek-ai/dsh-tool-web", enabled: 1, fiberPhase: 5 }, // tolerated coercions
				{ entryId: "nameless" }, // no moduleName: dropped, never guessed
				null,
				"junk",
			];
		},
	};
	const adapters = createHostAdapters({ async list() { return []; }, async resolve() { throw new Error("unused"); } }, { pluginInventory });
	assert.deepEqual(await adapters.listInventory(), [
		{ entryId: "persona", moduleName: "@deepseek-ai/dsh-persona", enabled: true, fiberPhase: "active" },
		{ entryId: "", moduleName: "@deepseek-ai/dsh-tool-web", enabled: false, fiberPhase: null },
	]);
});

test("a missing plugin-inventory service degrades to an empty roster, not an error", async () => {
	const route = createPresetAuthoringRoute(controllerWith(undefined));
	const response = await request(route, { sessionId: "s1", command: { type: "inventory.list" } });
	assert.equal(response.status, 200);
	assert.deepEqual(response.body.value, { entries: [] });

	const broken = createHostAdapters({ async list() { return []; }, async resolve() { throw new Error("unused"); } }, { pluginInventory: { list: "not a function" } });
	assert.deepEqual(await broken.listInventory(), []);
});

test("inventory stays read-only: no host adapter side effects and no draft mutation", async () => {
	const calls = [];
	const controller = controllerWith({ async list() { calls.push("list"); return wireEntries; } });
	const value = await controller.command({ type: "inventory.list" });
	assert.equal(calls.length, 1);
	assert.equal(value.entries.length, 3);
	// an unknown command still rejects; inventory added no new mutation surface
	await assert.rejects(
		controller.command({ type: "inventory.mutate" }),
		(error) => error.code === "UNKNOWN_COMMAND",
	);
});
