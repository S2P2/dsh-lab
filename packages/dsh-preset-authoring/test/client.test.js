import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function reactHarness() {
	let states = [];
	let stateAt = 0;
	let effectAt = 0;
	let pendingEffects = [];
	const effects = [];
	const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
	const React = {
		createElement(type, props, ...children) {
			return { type, props: { ...(props || {}), children: children.flat() } };
		},
		useState(initial) {
			const at = stateAt++;
			if (!(at in states)) states[at] = typeof initial === "function" ? initial() : initial;
			return [states[at], (next) => { states[at] = typeof next === "function" ? next(states[at]) : next; }];
		},
		useEffect(effect, deps) {
			const at = effectAt++;
			if (!same(effects[at]?.deps, deps)) pendingEffects.push({ at, effect, deps });
		},
		useCallback(fn) { return fn; },
	};
	return {
		React,
		render(Component, props) {
			stateAt = 0;
			effectAt = 0;
			pendingEffects = [];
			const tree = Component(props);
			for (const item of pendingEffects) {
				effects[item.at]?.cleanup?.();
				effects[item.at] = { deps: item.deps, cleanup: item.effect() };
			}
			return tree;
		},
		dispose() { for (const item of effects) item?.cleanup?.(); },
	};
}

function loadBundle({ React = { createElement: () => ({}) }, fetch, console = { warn() {}, error() {} } } = {}) {
	let spec;
	const intervals = [];
	const sandbox = {
		window: {
			location: { origin: "http://127.0.0.1:3080" },
			__ModuleLoader__: { load(value) { spec = value; } },
		},
		document: undefined,
		fetch: fetch || (async () => ({ ok: true, json: async () => ({ ok: true, value: {} }) })),
		console,
		setInterval(fn) { intervals.push(fn); return intervals.length; },
		clearInterval() {},
		setTimeout,
		clearTimeout,
	};
	vm.createContext(sandbox);
	new vm.Script(readFileSync(new URL("../src/client.js", import.meta.url), "utf8"), {
		filename: "dsh-preset-authoring/client.js",
	}).runInContext(sandbox);
	assert.ok(spec, "the hand-authored browser bundle registers");
	assert.equal(spec.id, "@s2p2/dsh-preset-authoring");
	const plugin = spec.factory((name) => {
		assert.equal(name, "react", "the browser bundle only value-imports React");
		return React;
	});
	return { plugin, intervals };
}

function context(service) {
	const cleanups = [];
	return {
		cleanups,
		get(name) { assert.equal(name, "betterSidebar"); return service.current; },
		effect(fn) { const cleanup = fn(); cleanups.push(cleanup); return cleanup; },
	};
}

function resolved(node) {
	return node && typeof node === "object" && typeof node.type === "function" ? node.type(node.props) : node;
}

function textOf(node) {
	node = resolved(node);
	if (node === null || node === undefined || node === false) return "";
	if (typeof node !== "object") return String(node);
	return (node.props?.children || []).map(textOf).join(" ");
}

function findAll(node, predicate, out = []) {
	node = resolved(node);
	if (node && typeof node === "object") {
		if (predicate(node)) out.push(node);
		for (const child of node.props?.children || []) findAll(child, predicate, out);
	}
	return out;
}

const panel = {
	sessionPresetId: "custom-creator",
	targets: [
		{ id: "system", title: "System", editable: false, origin: "system" },
		{ id: "worker", title: "Worker", editable: true, origin: "user" },
	],
	target: { id: "system", editable: false },
	stale: true,
	inspection: {
		categories: [
			{ id: "prompt", title: "Prompt / behavior", rows: [{ id: "persona", title: "Persona", enabled: true, value: "Careful", provenance: "persona plugin", control: { type: "text" } }] },
			{ id: "model", title: "Model", rows: [] },
			{ id: "plugins", title: "Plugins", rows: [{ id: "mystery", title: "Mystery", metadata: "uninspected" }] },
			{ id: "skills", title: "Skills", rows: [] },
			{ id: "tools", title: "Tools", rows: [] },
			{ id: "mcp", title: "MCP", rows: [] },
			{ id: "other", title: "Other", rows: [] },
		],
	},
	semanticDiff: { status: "ready", value: ["Persona changed"] },
	rawDiff: { status: "ready", value: "- old\n+ new" },
	preflight: { status: "failed", diagnostic: { message: "schema mismatch" } },
	mount: { status: "blocked", diagnostic: { message: "stale preset draft" } },
	apply: { status: "idle" },
	history: { status: "ready", value: [{ revision: "abc", title: "Known good" }] },
	test: { status: "idle" },
};

test("registers one profile-wide single Preset tab and disposes on unload", () => {
	const calls = [];
	const service = { current: { registerTab(tab) { calls.push(tab); return () => calls.push("disposed"); } } };
	const { plugin } = loadBundle();
	assert.deepEqual([...plugin.inject], []);
	const ctx = context(service);
	plugin.apply(ctx, { transport: { command: async () => panel } });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].id, "s2p2:preset");
	assert.equal(calls[0].title, "Preset");
	assert.equal(calls[0].single, true);
	assert.equal(typeof calls[0].component, "function");
	ctx.cleanups[0]();
	assert.equal(calls.at(-1), "disposed");
});

test("loads safely without Better Sidebar and reconciles when it appears later", () => {
	const warnings = [];
	const service = { current: undefined };
	const { plugin, intervals } = loadBundle({ console: { warn: (...args) => warnings.push(args.join(" ")), error() {} } });
	const ctx = context(service);
	assert.doesNotThrow(() => plugin.apply(ctx, { transport: { command: async () => panel } }));
	assert.match(warnings.join("\n"), /Better Sidebar.*required/i);
	assert.equal(plugin.getIntegrationStatus().state, "missing-sidebar");
	let disposed = false;
	let tab;
	service.current = { registerTab(value) { tab = value; return () => { disposed = true; }; } };
	intervals[0]();
	assert.equal(tab.title, "Preset");
	assert.equal(plugin.getIntegrationStatus().state, "registered");
	ctx.cleanups[0]();
	assert.equal(disposed, true);
});

test("same-origin transport sends scoped JSON commands and preserves host diagnostics", async () => {
	let request;
	const fetch = async (url, init) => {
		request = { url, init, body: JSON.parse(init.body) };
		return { ok: false, status: 409, json: async () => ({ ok: false, error: { code: "STALE_PRESET_DRAFT", message: "saved target changed" } }) };
	};
	const { plugin } = loadBundle({ fetch });
	await assert.rejects(
		plugin.createTransport().command({ type: "draft.apply" }, { sessionId: "s1", cwd: "/work" }),
		(error) => error.code === "STALE_PRESET_DRAFT" && /saved target changed/.test(error.message),
	);
	assert.equal(request.url, "/dsh-preset-authoring/api");
	assert.equal(request.init.method, "POST");
	assert.deepEqual({ ...request.body }, { sessionId: "s1", cwd: "/work", command: { type: "draft.apply" } });
});

test("visible component fetches Host snapshots and exposes the authoring workflow without client draft state", async () => {
	const harness = reactHarness();
	const commands = [];
	const transport = { command: async (command, scope) => { commands.push({ command, scope }); return panel; } };
	const calls = [];
	const service = { current: { registerTab(tab) { calls.push(tab); return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 20 });
	const Component = calls[0].component;
	const props = { visible: true, scope: { sessionId: "creator-session", cwd: "/repo" }, tab: {} };
	harness.render(Component, props);
	await new Promise((resolve) => setImmediate(resolve));
	const tree = harness.render(Component, props);
	const text = textOf(tree);
	assert.match(text, /Session preset\s+custom-creator/);
	assert.match(text, /Target preset/);
	assert.match(text, /System.*read-only/);
	assert.match(text, /Copy to editable/);
	for (const category of ["Prompt / behavior", "Model", "Plugins", "Skills", "Tools", "MCP", "Other"]) assert.match(text, new RegExp(category.replace("/", "\\/")));
	assert.match(text, /uninspected/);
	assert.match(text, /stale/i);
	assert.match(text, /Preflight.*schema mismatch/s);
	assert.match(text, /Mount.*stale preset draft/s);
	assert.match(text, /Semantic diff.*Persona changed/s);
	assert.match(text, /Raw diff.*- old.*\+ new/s);
	assert.match(text, /Known good.*Restore/s);
	assert.match(text, /Test in fresh session/);
	assert.equal(commands[0].command.type, "panel.snapshot");

	const select = findAll(tree, (node) => node.type === "select")[0];
	select.props.onChange({ target: { value: "worker" } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(commands.some(({ command }) => command.type === "target.open" && command.targetId === "worker"), true);
	assert.equal(commands.some(({ command }) => command.type === "session.set"), false, "target changes never mutate the session preset");

	const input = findAll(tree, (node) => node.type === "input" && node.props["data-row-id"] === "persona")[0];
	input.props.onBlur({ target: { value: "Precise" } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(commands.some(({ command }) => command.type === "draft.edit" && command.rowId === "persona" && command.value === "Precise"), true);
	harness.dispose();
});

test("hidden component neither fetches nor polls", async () => {
	const harness = reactHarness();
	const commands = [];
	const transport = { command: async (command) => { commands.push(command); return panel; } };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 10 });
	harness.render(descriptor.component, { visible: false, scope: { sessionId: "s1" }, tab: {} });
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.deepEqual(commands, []);
	harness.dispose();
});
