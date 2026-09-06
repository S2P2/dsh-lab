import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createPresetAuthoringRoute } from "../src/index.js";

async function request(handler, { method = "POST", origin, remoteAddress, body = "{}" } = {}) {
	const req = Readable.from([body]);
	req.method = method;
	req.headers = { host: "127.0.0.1:3080", ...(origin ? { origin } : {}) };
	req.socket = { remoteAddress };
	let status;
	let headers;
	let text = "";
	const res = { writeHead(value, values) { status = value; headers = values; }, end(value = "") { text += value; } };
	await handler(req, res);
	return { status, headers, body: JSON.parse(text) };
}

test("route is exact-contract POST-only, same-origin, bounded, and returns stable diagnostics", async () => {
	const commands = [];
	const route = createPresetAuthoringRoute({ async command(command) { commands.push(command); return { target: null }; } });
	assert.equal((await request(route, { method: "GET" })).status, 405);
	assert.equal((await request(route, { origin: "https://evil.example", body: JSON.stringify({ command: { type: "panel.snapshot" } }) })).body.error.code, "CROSS_ORIGIN_REQUEST");
	assert.equal((await request(route, { body: "{" })).body.error.code, "INVALID_JSON");
	assert.equal((await request(route, { body: `{"x":"${"a".repeat(70_000)}"}` })).body.error.code, "REQUEST_TOO_LARGE");
	const ok = await request(route, { origin: "http://127.0.0.1:3080", body: JSON.stringify({ command: { type: "panel.snapshot" } }) });
	assert.equal(ok.status, 200);
	assert.deepEqual(commands, [{ type: "panel.snapshot" }]);
	assert.equal(ok.headers["cache-control"], "no-store");
});

test("originless mutations are accepted only from trusted loopback clients", async () => {
	const commands = [];
	const route = createPresetAuthoringRoute({ async command(command) { commands.push(command); return {}; } });
	const body = JSON.stringify({ command: { type: "draft.apply" } });
	assert.equal((await request(route, { body, remoteAddress: "10.0.0.2" })).body.error.code, "ORIGIN_REQUIRED");
	assert.equal(commands.length, 0);
	assert.equal((await request(route, { body, remoteAddress: "127.0.0.1" })).status, 200);
	assert.equal(commands.length, 1);
	assert.equal((await request(route, { body: JSON.stringify({ command: { type: "panel.snapshot" } }) })).status, 200, "originless read-only snapshots are safe");
});

test("route preserves bounded recovery diagnostics without serializing private details", async () => {
	const error = Object.assign(new Error("validation failed"), {
		code: "PRESET_VALIDATION_UNRECOVERED",
		recovery: { status: "degraded", diagnostic: { message: "/secret/path" } },
		fallbackRecovery: Object.assign(new Error("/other/secret"), { status: "failed" }),
		recoveryState: "unrecovered",
	});
	const route = createPresetAuthoringRoute({ async command() { throw error; } });
	const response = await request(route, { origin: "http://127.0.0.1:3080", body: JSON.stringify({ command: { type: "draft.apply" } }) });
	assert.deepEqual(response.body.error, {
		code: "PRESET_VALIDATION_UNRECOVERED",
		message: "validation failed",
		recovery: { status: "degraded" },
		fallbackRecovery: { status: "failed" },
		recoveryState: "unrecovered",
	});
});
