import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

/**
 * Load the hand-authored browser bundle the way the browser would: capture
 * the __ModuleLoader__.load spec from a sandboxed window, run the factory
 * against a React surrogate, and exercise the registration + selector — the
 * pieces whose failure mode is a silent takeover miss (a crashed selector
 * just declines). Card rendering is manual dogfooding per issue #2.
 */
function loadBundle() {
	let spec = null;
	const sandbox = {
		window: {
			__ModuleLoader__: {
				load: (s) => {
					spec = s;
				},
			},
		},
	};
	vm.createContext(sandbox);
	new vm.Script(readFileSync(new URL("../src/client.js", import.meta.url), "utf8"), {
		filename: "dsh-grilling-card/client.js",
	}).runInContext(sandbox);
	assert.ok(spec, "the bundle registers through window.__ModuleLoader__.load");
	assert.equal(spec.id, "@s2p2/dsh-grilling-card");
	const reactSurrogate = { createElement: () => ({}) };
	const plugin = spec.factory((name) => {
		assert.equal(name, "react", "the bundle value-imports nothing but react");
		return reactSurrogate;
	});
	assert.equal(typeof plugin.apply, "function");
	assert.deepEqual([...plugin.inject], ["slots"]);
	return plugin;
}

function registered(plugin) {
	const registrations = [];
	const ctx = {
		slots: {
			inject: (_key, effect) => {
				effect();
			},
			register: (options, component) => {
				registrations.push({ options, component });
				return () => {};
			},
		},
	};
	plugin.apply(ctx);
	return registrations;
}

test("the bundle claims the composer chain at priority -1 and the grill_round toolview key", () => {
	const [composer, toolview] = registered(loadBundle());
	assert.equal(composer.options.name, "conversation.composer");
	assert.equal(composer.options.priority, -1);
	assert.equal(typeof composer.options.select, "function");
	assert.equal(typeof composer.component, "function");
	assert.equal(toolview.options.name, "tool.call.toolview");
	assert.equal(toolview.options.key, "grill_round");
	assert.equal(typeof toolview.component, "function");
});

const grillBatch = {
	kind: "question",
	key: "wait-1",
	sessionId: "s1",
	payload: {
		questions: [
			{ id: "grill:q1", question: "a?", options: [{ label: "x" }], multiSelect: true },
			{ id: "grill:q2", question: "b?", options: [{ label: "y" }], multiSelect: true },
		],
	},
};

test("the selector claims batches whose every question id carries the grill: prefix", () => {
	const [composer] = registered(loadBundle());
	const select = composer.options.select;
	assert.equal(select({ interactions: [grillBatch] }), grillBatch);
});

test("the selector declines everything the shipped composer must keep", () => {
	const [composer] = registered(loadBundle());
	const select = composer.options.select;
	const plain = {
		kind: "question",
		key: "w2",
		payload: { questions: [{ id: "plain", question: "?", options: [] }] },
	};
	const mixed = {
		kind: "question",
		key: "w3",
		payload: {
			questions: [
				{ id: "grill:q1", question: "?", options: [] },
				{ id: "other", question: "?", options: [] },
			],
		},
	};
	assert.equal(select({ interactions: [plain] }), null, "non-grill questions fall through");
	assert.equal(select({ interactions: [mixed] }), null, "mixed batches fall through");
	assert.equal(select({ interactions: [{ kind: "approval" }] }), null, "approvals fall through");
	assert.equal(select({ interactions: [] }), null, "no interactions at all");
	assert.equal(select({ interactions: [{ kind: "question", payload: {} }] }), null, "no questions array");
	assert.equal(select({}), null, "missing interactions prop never crashes");
});
