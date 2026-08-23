import assert from "node:assert/strict";
import { test } from "node:test";
import { apply } from "../src/index.js";

/**
 * Boot regression: DSH's raw `ctx.tools.register` runs
 * `assertSupportedJsonSchema` over `output.schema` at registration
 * (ToolRuntime.register), and the enforced raw subset allows `required`
 * only on object schemas, as a string[] of declared property names — never
 * property-level `required: true` (that form exists only in `defineTool`'s
 * spec input, which compiles it away). v0.1 shipped property-level
 * `required` here and booted the profile into UNSUPPORTED_SCHEMA while the
 * stubbed tool-seam tests stayed green.
 *
 * Oracle: the real validator from the installed dsh runtime when resolvable
 * (the npx install this machine boots), else a transcription of the
 * `required` rule from dsh-tools/src/json-schema.ts — so the test bites
 * everywhere, harder where the real binary lives.
 */

const CANDIDATE_ROOTS = [
	process.env.DSH_TOOLS_PATH,
	"/home/jo/.npm/_npx/de4831d60afe10da/node_modules/@deepseek-ai/dsh-tools/lib/index.js",
].filter(Boolean);

async function loadRealValidator() {
	for (const candidate of CANDIDATE_ROOTS) {
		try {
			const mod = await import(new URL(`file://${candidate}`).href);
			if (typeof mod.assertSupportedJsonSchema === "function") {
				return mod.assertSupportedJsonSchema;
			}
		} catch {
			/* try next candidate */
		}
	}
	return null;
}

/** Transcribed `required` rule from the enforced subset (dsh-tools json-schema.ts):
 * `required` is supported only on type "object" and must be an array of
 * declared property names. */
function transcribedViolations(node, path, violations) {
	if (typeof node !== "object" || node === null) return;
	if (Object.hasOwn(node, "required")) {
		const onObject = node.type === "object";
		const isNameArray =
			Array.isArray(node.required) &&
			node.required.every((name) => typeof name === "string") &&
			(onObject
				? node.required.every((name) =>
						Object.hasOwn(node.properties ?? {}, name),
					)
				: false);
		if (!onObject || !isNameArray) {
			violations.push(
				`${path}.required must be an object-level array of declared property names`,
			);
		}
	}
	for (const [key, child] of Object.entries(node.properties ?? {})) {
		transcribedViolations(child, `${path}.properties.${key}`, violations);
	}
	if (node.items) transcribedViolations(node.items, `${path}.items`, violations);
}

test("the registered grill_round schemas satisfy DSH's raw schema subset (boot regression)", async () => {
	let definition;
	apply({
		tools: {
			register(def) {
				definition = def;
				return () => {};
			},
		},
		userQuestions: { ask: async () => ({ answers: [] }) },
	});
	assert.ok(definition, "the plugin registered a tool");
	const realValidator = await loadRealValidator();
	for (const [name, schema] of [
		["parameters", definition.parameters],
		["output.schema", definition.output.schema],
	]) {
		if (realValidator) {
			realValidator(schema); // throws on the first violation
		} else {
			const violations = [];
			transcribedViolations(schema, name, violations);
			assert.deepEqual(violations, [], `${name} stays inside the raw subset`);
		}
	}
	// The contract the schema exists to pin: required answer fields.
	const answerItem = definition.output.schema.properties.answers.items;
	assert.deepEqual(
		[...answerItem.required].sort(),
		["id", "selected", "status"],
	);
	assert.deepEqual(definition.output.schema.required, ["answers"]);
});
