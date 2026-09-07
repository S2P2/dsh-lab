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

function buttonText(node) {
	return textOf(node).trim();
}

// A studio-presenter panel snapshot as the shipped tab consumes it.
const panel = {
	revision: 17,
	sourceFingerprint: "source-fingerprint",
	draftFingerprint: "draft-fingerprint",
	sessionPresetId: "custom-creator",
	targets: [
		{ id: "system", title: "System", editable: false, trust: "system" },
		{ id: "worker", title: "Worker", editable: true, trust: "user" },
	],
	target: { id: "system", title: "System", editable: false, trust: "system" },
	stale: true,
	composition: {
		path: "agent.cordis.yml",
		present: true,
		source: "# fork\n- id: persona\n  name: '@deepseek-ai/dsh-persona'\n",
		draft: "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: hello\n",
		rows: [
			{ depth: 0, kind: "prompt", id: "persona", name: "@deepseek-ai/dsh-persona", disabled: false },
			{ depth: 0, kind: "group", id: "delegation", name: "cordis:group", disabled: false },
			{ depth: 1, kind: "delegation", id: "tool-subagent", name: "@deepseek-ai/dsh-tool-subagent", disabled: true },
		],
		editor: [
			{ key: "0", id: "persona", name: "@deepseek-ai/dsh-persona", disabled: false, group: false, isolate: {}, configText: "text: hello", children: [] },
			{
				key: "1", id: "delegation", name: "cordis:group", disabled: false, group: true, isolate: { workflowEngine: true }, configText: "", children: [
					{ key: "1.0", id: "tool-subagent", name: "@deepseek-ai/dsh-tool-subagent", disabled: true, group: false, isolate: {}, configText: "provider: spawn", children: [] },
				],
			},
		],
	},
	semanticDiff: { status: "ready", value: ["Persona changed"] },
	rawDiff: { status: "ready", value: "- old\n+ new" },
	preflight: { status: "failed", diagnostic: { message: "schema mismatch" } },
	mount: { status: "blocked", diagnostic: { message: "stale preset draft", recoveryState: "recovered-via-fallback" } },
	apply: { status: "idle" },
	history: { status: "ready", value: [{ revision: "abc", title: "Known good" }] },
	test: { status: "idle" },
};

const inventory = { entries: [{ entryId: "bash", moduleName: "@deepseek-ai/dsh-tool-bash", enabled: true, fiberPhase: "active" }] };

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

test("visible studio tab fetches snapshots plus inventory and renders every surface without client draft state", async () => {
	const harness = reactHarness();
	const commands = [];
	const transport = { command: async (command, scope) => { commands.push({ command, scope }); return command.type === "inventory.list" ? inventory : panel; } };
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
	assert.match(text, /System.*read-only.*system/s);
	assert.match(text, /Copy to editable/);
	assert.match(text, /stale/i);
	assert.match(text, /Composition/);
	assert.match(text, /Row editor/);
	assert.match(text, /Raw YAML/);
	// composition viewer: rows grouped by display kind, nested rows indented
	assert.match(text, /Prompt.*@deepseek-ai\/dsh-persona/s);
	assert.match(text, /Groups.*cordis:group/s);
	assert.match(text, /Delegation.*tool-subagent.*disabled/s);
	// shared lifecycle slots stay rendered as-is
	assert.match(text, /Preflight.*schema mismatch/s);
	assert.match(text, /Mount.*stale preset draft.*Recovered via captured-source fallback/s);
	assert.match(text, /Semantic diff.*Persona changed/s);
	assert.match(text, /Raw diff.*- old.*\+ new/s);
	assert.match(text, /Known good.*Restore/s);
	assert.match(text, /Test in fresh session/);
	assert.equal(commands[0].command.type, "panel.snapshot");
	assert.ok(commands.some(({ command }) => command.type === "inventory.list"), "installed packages are fetched through the Host command, never the browser API");
	assert.equal(commands.some(({ command }) => command.type === "session.set"), false, "the tab never mutates the session preset");

	// target switch goes through target.open with no local roster truth
	const select = findAll(tree, (node) => node.type === "select")[0];
	select.props.onChange({ target: { value: "worker" } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(commands.some(({ command }) => command.type === "target.open" && command.targetId === "worker"), true);
	harness.dispose();
});

test("row editor edits a local tree and saves it CAS-guarded through draft.putRows", async () => {
	const harness = reactHarness();
	let current = panel;
	const commands = [];
	const transport = { command: async (command, scope) => { commands.push({ command, scope }); return command.type === "inventory.list" ? inventory : current; } };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 20 });
	const props = { visible: true, scope: { sessionId: "s" }, tab: {} };
	harness.render(descriptor.component, props);
	await new Promise((resolve) => setImmediate(resolve));
	let tree = harness.render(descriptor.component, props);

	// switch to the row editor; a read-only target renders disabled controls
	const editorTab = findAll(tree, (node) => node.type === "button" && buttonText(node) === "Row editor")[0];
	editorTab.props.onClick();
	tree = harness.render(descriptor.component, props);
	let nameInput = findAll(tree, (node) => node.type === "input" && node.props.list === "s2p2p-inventory-names")[0];
	assert.equal(nameInput.props.value, "@deepseek-ai/dsh-persona");
	assert.equal(nameInput.props.disabled, true, "read-only targets cannot be edited in place");
	assert.equal(findAll(tree, (node) => node.type === "button" && buttonText(node) === "Save rows to draft")[0].props.disabled, true);

	// an editable target enables the generic editor (after the snapshot refreshes)
	current = { ...panel, target: panel.targets[1], stale: false };
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Refresh checks & diff")[0].props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	tree = harness.render(descriptor.component, props);
	nameInput = findAll(tree, (node) => node.type === "input" && node.props.list === "s2p2p-inventory-names")[0];
	assert.equal(nameInput.props.disabled, false);
	// the package selector datalist is the sorted inventory module names + cordis:group
	const datalist = findAll(tree, (node) => node.type === "datalist")[0];
	assert.deepEqual(findAll(datalist, (node) => node.type === "option").map((option) => option.props.value), ["@deepseek-ai/dsh-tool-bash", "cordis:group"]);

	// per-row id, disabled checkbox, config textarea, remove, and nested group rows
	const rowById = (key) => findAll(tree, (node) => node.type === "div" && node.props["data-row-key"] === key)[0];
	assert.ok(rowById("0"));
	assert.ok(rowById("1"));
	assert.ok(rowById("1.0"), "nested group rows render recursively");
	const textarea = findAll(rowById("0"), (node) => node.type === "textarea")[0];
	assert.equal(textarea.props.value, "text: hello");
	const checkbox = findAll(rowById("0"), (node) => node.type === "input" && node.props.type === "checkbox")[0];
	assert.equal(checkbox.props.checked, false);
	const idInput = findAll(rowById("0"), (node) => node.type === "input" && node.props["aria-label"] === "Row id")[0];
	assert.equal(idInput.props.value, "persona");

	// edits stay local (a second draft never lives in the browser)…
	idInput.props.onChange({ target: { value: "persona-2" } });
	tree = harness.render(descriptor.component, props);
	assert.equal(findAll(tree, (node) => node.type === "input" && node.props["aria-label"] === "Row id")[0].props.value, "persona-2");
	// …until Save sends the whole tree through the guarded Host command
	const save = findAll(tree, (node) => node.type === "button" && buttonText(node) === "Save rows to draft")[0];
	save.props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	const putRows = commands.find(({ command }) => command.type === "draft.putRows").command;
	assert.deepEqual({ targetId: putRows.targetId, expectedRevision: putRows.expectedRevision, expectedSourceFingerprint: putRows.expectedSourceFingerprint, expectedDraftFingerprint: putRows.expectedDraftFingerprint }, {
		targetId: "worker",
		expectedRevision: 17,
		expectedSourceFingerprint: "source-fingerprint",
		expectedDraftFingerprint: "draft-fingerprint",
	});
	assert.equal(putRows.rows.find((row) => row.key === "0").id, "persona-2");
	assert.equal(putRows.rows.find((row) => row.key === "1").children.length, 1, "group nesting survives the round trip");

	// add + remove rows re-patch the local tree only
	tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "+ Add row")[0].props.onClick();
	tree = harness.render(descriptor.component, props);
	const addedRow = findAll(tree, (node) => node.type === "div" && typeof node.props["data-row-key"] === "string" && node.props["data-row-key"].startsWith("new-"))[0];
	assert.ok(addedRow, "an added row renders with a fresh key");
	findAll(addedRow, (node) => node.type === "button" && node.props["aria-label"] === "Remove row")[0].props.onClick();
	tree = harness.render(descriptor.component, props);
	assert.equal(findAll(tree, (node) => node.type === "div" && typeof node.props["data-row-key"] === "string" && node.props["data-row-key"].startsWith("new-")).length, 0);
	harness.dispose();
});

test("raw YAML view shows the draft and saved source plus the fidelity note", async () => {
	const harness = reactHarness();
	const transport = { command: async (command) => (command.type === "inventory.list" ? inventory : panel) };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 20 });
	const props = { visible: true, scope: { sessionId: "s" }, tab: {} };
	harness.render(descriptor.component, props);
	await new Promise((resolve) => setImmediate(resolve));
	let tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Raw YAML")[0].props.onClick();
	tree = harness.render(descriptor.component, props);
	const text = textOf(tree);
	assert.match(text, /comments are dropped and key order is normalized/i);
	assert.match(text, /the saved file changes only on Apply/i);
	assert.match(text, /Draft ·\s+agent\.cordis\.yml/);
	assert.match(text, /text: hello/);
	assert.match(text, /Saved source ·\s+agent\.cordis\.yml/);
	assert.match(text, /# fork/);
	harness.dispose();
});

test("a draft that changed elsewhere shows a divergence banner instead of clobbering local edits", async () => {
	const harness = reactHarness();
	let current = { ...panel, target: panel.targets[1], stale: false };
	const commands = [];
	const transport = { command: async (command) => { commands.push(command); return command.type === "inventory.list" ? inventory : current; } };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 20 });
	const props = { visible: true, scope: { sessionId: "s" }, tab: {} };
	harness.render(descriptor.component, props);
	await new Promise((resolve) => setImmediate(resolve));
	let tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Row editor")[0].props.onClick();
	tree = harness.render(descriptor.component, props);
	assert.equal(textOf(tree).includes("shared draft changed after these rows were loaded"), false);
	// another surface (bridge, Apply, restore) advances the shared draft
	current = { ...current, revision: 18, draftFingerprint: "moved-on" };
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Refresh checks & diff")[0].props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	tree = harness.render(descriptor.component, props);
	assert.match(textOf(tree), /shared draft changed after these rows were loaded/);
	// reload adopts the current draft and clears the banner
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Reload rows")[0].props.onClick();
	tree = harness.render(descriptor.component, props);
	assert.equal(textOf(tree).includes("shared draft changed after these rows were loaded"), false);
	// saves against the adopted snapshot carry the fresh CAS fields
	const save = findAll(tree, (node) => node.type === "button" && buttonText(node) === "Save rows to draft")[0];
	save.props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	const putRows = commands.filter(({ type }) => type === "draft.putRows").at(-1);
	assert.equal(putRows.expectedRevision, 18);
	assert.equal(putRows.expectedDraftFingerprint, "moved-on");
	harness.dispose();
});

test("read-only target copies through the in-panel form, never window.prompt, and opens the editable copy", async () => {
	// the panel bundle must not fall back to blocking browser dialogs
	assert.equal(/\bwindow\.prompt\b|\bprompt\s*\(/.test(readFileSync(new URL("../src/client.js", import.meta.url), "utf8")), false);

	const harness = reactHarness();
	const copied = { id: "creator-copy", title: "My Copy", editable: true, trust: "user" };
	let current = panel; // target: system (read-only)
	const commands = [];
	const transport = { command: async (command, scope) => {
		commands.push({ command, scope });
		if (command.type === "inventory.list") return inventory;
		if (command.type === "target.copy") {
			current = { ...panel, targets: [...panel.targets, copied], target: copied, stale: false };
			return current;
		}
		return current;
	} };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 20 });
	const props = { visible: true, scope: { sessionId: "s" }, tab: {} };
	harness.render(descriptor.component, props);
	await new Promise((resolve) => setImmediate(resolve));
	let tree = harness.render(descriptor.component, props);

	// the in-panel form replaces the prompt dialog; source defaults to the read-only target
	const form = findAll(tree, (node) => node.props["data-copy-form"] === "")[0];
	assert.ok(form, "selecting a read-only target shows the in-panel copy form");
	assert.equal(findAll(form, (node) => node.type === "select")[0].props.value, "system");
	assert.deepEqual(
		findAll(form, (node) => node.type === "option").map((option) => option.props.value),
		["system", "worker"],
	);

	// an empty id is refused in-panel without a round trip
	findAll(form, (node) => node.type === "button" && buttonText(node) === "Copy to editable")[0].props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	tree = harness.render(descriptor.component, props);
	assert.match(textOf(tree), /A new preset id is required/);
	assert.equal(commands.some(({ command }) => command.type === "target.copy"), false);

	// a filled form copies through the Host seam and opens the editable result
	const idInput = findAll(tree, (node) => node.props["aria-label"] === "New preset id")[0];
	idInput.props.onChange({ target: { value: " creator-copy " } });
	findAll(tree, (node) => node.props["aria-label"] === "New preset name")[0].props.onChange({ target: { value: "My Copy" } });
	tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Copy to editable")[0].props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	const copyCommand = commands.find(({ command }) => command.type === "target.copy").command;
	assert.deepEqual({ type: copyCommand.type, sourceId: copyCommand.sourceId, targetId: copyCommand.targetId, name: copyCommand.name }, {
		type: "target.copy", sourceId: "system", targetId: "creator-copy", name: "My Copy",
	});

	tree = harness.render(descriptor.component, props);
	const text = textOf(tree);
	assert.match(text, /My Copy user editable/, "the editable copy becomes the target");
	assert.match(text, /Copied to creator-copy/);
	assert.equal(findAll(tree, (node) => node.props["data-copy-form"] === "").length, 0, "the copy form closes for an editable target");
	// the copy is immediately editable: the generic row editor unlocks
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Row editor")[0].props.onClick();
	tree = harness.render(descriptor.component, props);
	assert.equal(findAll(tree, (node) => node.type === "input" && node.props.list === "s2p2p-inventory-names")[0].props.disabled, false);
	harness.dispose();
});

test("a failed copy keeps the form open with the Host diagnostic", async () => {
	const harness = reactHarness();
	const commands = [];
	const transport = { command: async (command) => {
		commands.push(command);
		if (command.type === "inventory.list") return inventory;
		if (command.type === "target.copy") {
			throw Object.assign(new Error("preset id already exists"), { code: "PRESET_COPY_FAILED" });
		}
		return panel;
	} };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 20 });
	const props = { visible: true, scope: { sessionId: "s" }, tab: {} };
	harness.render(descriptor.component, props);
	await new Promise((resolve) => setImmediate(resolve));
	let tree = harness.render(descriptor.component, props);

	findAll(tree, (node) => node.props["aria-label"] === "New preset id")[0].props.onChange({ target: { value: "taken" } });
	tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Copy to editable")[0].props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	tree = harness.render(descriptor.component, props);

	assert.match(textOf(tree), /preset id already exists/, "the host diagnostic renders inline");
	const form = findAll(tree, (node) => node.props["data-copy-form"] === "")[0];
	assert.ok(form, "the form stays open with its values for a corrected retry");
	assert.equal(findAll(form, (node) => node.props["aria-label"] === "New preset id")[0].props.value, "taken");
	harness.dispose();
});

test("invalid row configs are flagged per row before Save without a server round trip", async () => {
	const harness = reactHarness();
	let current = { ...panel, target: panel.targets[1], stale: false };
	const commands = [];
	const transport = { command: async (command) => { commands.push(command); return command.type === "inventory.list" ? inventory : current; } };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 20 });
	const props = { visible: true, scope: { sessionId: "s" }, tab: {} };
	harness.render(descriptor.component, props);
	await new Promise((resolve) => setImmediate(resolve));
	let tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Row editor")[0].props.onClick();
	tree = harness.render(descriptor.component, props);

	const rowById = (key) => findAll(tree, (node) => node.type === "div" && node.props["data-row-key"] === key)[0];
	const alertOf = (row) => findAll(row, (node) => node.props.role === "alert")[0];
	const saveButton = () => findAll(tree, (node) => node.type === "button" && buttonText(node) === "Save rows to draft")[0];

	// unbalanced flow collection: flagged on that row only; Save disabled; nothing sent
	findAll(rowById("0"), (node) => node.type === "textarea")[0].props.onChange({ target: { value: "text: [unclosed" } });
	tree = harness.render(descriptor.component, props);
	assert.match(textOf(alertOf(rowById("0"))), /unbalanced \[ or \{/);
	assert.equal(findAll(rowById("0"), (node) => node.type === "textarea")[0].props["aria-invalid"], true);
	assert.equal(alertOf(rowById("1")), undefined, "other rows are not flagged");
	assert.equal(saveButton().props.disabled, true);
	assert.match(textOf(tree), /1\s+row\s+cannot be saved yet/);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(commands.some(({ type }) => type === "draft.putRows"), false, "no save round trip happens");

	// a missing package name is flagged the same way
	findAll(rowById("0"), (node) => node.type === "input" && node.props["aria-label"] === "Package name")[0].props.onChange({ target: { value: " " } });
	tree = harness.render(descriptor.component, props);
	assert.match(textOf(alertOf(rowById("0"))), /needs a package name/);

	// fixing the row re-enables the save
	findAll(rowById("0"), (node) => node.type === "textarea")[0].props.onChange({ target: { value: "text: ok" } });
	findAll(rowById("0"), (node) => node.type === "input" && node.props["aria-label"] === "Package name")[0].props.onChange({ target: { value: "@deepseek-ai/dsh-persona" } });
	tree = harness.render(descriptor.component, props);
	assert.equal(alertOf(rowById("0")), undefined);
	assert.equal(saveButton().props.disabled, false);
	harness.dispose();
});

test("a conflicted save refreshes the snapshot and guides a reload-and-retry", async () => {
	const harness = reactHarness();
	let current = { ...panel, target: panel.targets[1], stale: false };
	const commands = [];
	const transport = { command: async (command) => {
		commands.push(command);
		if (command.type === "inventory.list") return inventory;
		if (command.type === "draft.putRows") {
			// the shared draft moved on elsewhere while these rows were open
			current = { ...current, revision: 18, draftFingerprint: "moved-on" };
			throw Object.assign(new Error("preset draft changed; refresh and retry against the current snapshot"), { code: "PRESET_DRAFT_CONFLICT" });
		}
		return current;
	} };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 20 });
	const props = { visible: true, scope: { sessionId: "s" }, tab: {} };
	harness.render(descriptor.component, props);
	await new Promise((resolve) => setImmediate(resolve));
	let tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Row editor")[0].props.onClick();
	tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "input" && node.props["aria-label"] === "Row id")[0].props.onChange({ target: { value: "persona-2" } });
	tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Save rows to draft")[0].props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	tree = harness.render(descriptor.component, props);

	// the conflict surfaces with the divergence banner and a retry hint
	assert.match(textOf(tree), /preset draft changed; refresh and retry/);
	assert.match(textOf(tree), /shared draft changed after these rows were loaded/);
	assert.match(textOf(tree), /Use Reload rows to adopt the current draft, then save again/);

	// reload adopts the current draft; the retried save carries fresh CAS fields
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Reload rows")[0].props.onClick();
	tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "input" && node.props["aria-label"] === "Row id")[0].props.onChange({ target: { value: "persona-3" } });
	tree = harness.render(descriptor.component, props);
	findAll(tree, (node) => node.type === "button" && buttonText(node) === "Save rows to draft")[0].props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	const retry = commands.filter(({ type }) => type === "draft.putRows").at(-1);
	assert.equal(retry.expectedRevision, 18);
	assert.equal(retry.expectedDraftFingerprint, "moved-on");
	assert.equal(retry.rows.find((row) => row.key === "0").id, "persona-3", "the local edit survives the retry");
	harness.dispose();
});

test("the stale banner offers reopening the target as a fresh draft", async () => {
	const harness = reactHarness();
	const stalePanel = { ...panel, target: panel.targets[1], stale: true };
	const commands = [];
	const transport = { command: async (command) => { commands.push(command); return command.type === "inventory.list" ? inventory : stalePanel; } };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport, pollMs: 20 });
	const props = { visible: true, scope: { sessionId: "s" }, tab: {} };
	harness.render(descriptor.component, props);
	await new Promise((resolve) => setImmediate(resolve));
	const tree = harness.render(descriptor.component, props);

	assert.match(textOf(tree), /Stale Preset Draft/);
	const reopen = findAll(tree, (node) => node.type === "button" && buttonText(node) === "Reopen target")[0];
	assert.ok(reopen, "the banner carries an explicit reopen action");
	reopen.props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	const openCommand = commands.find(({ type }) => type === "target.open");
	assert.deepEqual({ type: openCommand.type, targetId: openCommand.targetId }, { type: "target.open", targetId: "worker" });
	harness.dispose();
});

test("target selector shows an explicit empty choice before a target is opened", async () => {
	const harness = reactHarness();
	const snapshot = { ...panel, target: null, stale: false, composition: { path: "agent.cordis.yml", present: false } };
	let descriptor;
	const service = { current: { registerTab(tab) { descriptor = tab; return () => {}; } } };
	const { plugin } = loadBundle({ React: harness.React });
	plugin.apply(context(service), { transport: { command: async (command) => (command.type === "inventory.list" ? inventory : snapshot) } });
	const props = { visible: true, scope: { sessionId: "creator-session", cwd: "/repo" }, tab: {} };
	harness.render(descriptor.component, props);
	await new Promise((resolve) => setImmediate(resolve));
	const tree = harness.render(descriptor.component, props);
	const select = findAll(tree, (node) => node.type === "select")[0];
	const options = findAll(select, (node) => node.type === "option");

	assert.equal(select.props.value, "");
	assert.equal(options[0].props.value, "");
	assert.match(textOf(options[0]), /Select a target/i);
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
