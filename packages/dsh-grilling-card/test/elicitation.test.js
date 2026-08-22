import assert from "node:assert/strict";
import { test } from "node:test";
import { toElicitation } from "../src/to-elicitation.js";
import { validateRoundArgs } from "../src/round.js";

const round = {
	detail: "Round preamble text.",
	progress: { round: 2, decisionsOpen: 3 },
	questions: [
		{
			id: "deploy",
			question: "Where does this deploy first?",
			options: [
				{ label: "staging", description: "cheap rehearsal" },
				{ label: "prod", description: "yolo" },
			],
			recommended: "staging",
		},
		{
			id: "regions",
			question: "Which regions?",
			options: [{ label: "eu" }, { label: "us" }, { label: "apac" }],
			recommended: "eu",
			multi: true,
		},
		{
			id: "narrative",
			question: "Describe the rollback plan.",
			draft: "Roll back by redeploying the previous image.",
		},
	],
};

/** The 2026-07-28 form-mode primitive types the spec allows. */
const PRIMITIVES = new Set(["string", "number", "integer", "boolean"]);

test("every round serializes to one elicitation form keyed by question id", () => {
	const form = toElicitation(round);
	assert.equal(form.mode, "form");
	assert.equal(form.message, round.detail);
	const schema = form.requestedSchema;
	assert.equal(schema.type, "object");
	assert.deepEqual(
		Object.keys(schema.properties),
		["deploy", "regions", "narrative"],
		"property names are the question ids",
	);
});

test("single choice maps to a string enum with the recommendation as default", () => {
	const { requestedSchema } = toElicitation(round);
	const deploy = requestedSchema.properties.deploy;
	assert.equal(deploy.type, "string");
	assert.deepEqual(deploy.enum, ["staging", "prod"]);
	assert.equal(deploy.default, "staging");
	assert.equal(deploy.title, round.questions[0].question);
	assert.equal(deploy.description, "★ staging — cheap rehearsal");
});

test("multi-select maps to an array of enum items with the recommendation as default", () => {
	const { requestedSchema } = toElicitation(round);
	const regions = requestedSchema.properties.regions;
	assert.equal(regions.type, "array");
	assert.equal(regions.items.type, "string");
	assert.deepEqual(regions.items.enum, ["eu", "us", "apac"]);
	assert.deepEqual(regions.default, ["eu"]);
});

test("narrative maps to a free string with the draft as default", () => {
	const { requestedSchema } = toElicitation(round);
	const narrative = requestedSchema.properties.narrative;
	assert.equal(narrative.type, "string");
	assert.equal(narrative.default, "Roll back by redeploying the previous image.");
	assert.equal("enum" in narrative, false);
});

test("every property stays inside the spec's flat primitive surface", () => {
	const { requestedSchema } = toElicitation(round);
	for (const property of Object.values(requestedSchema.properties)) {
		assert.ok(
			PRIMITIVES.has(property.type) || property.type === "array",
			`type "${property.type}" must be a spec primitive (or the multi-select array form)`,
		);
		if (property.type === "array") {
			assert.ok(PRIMITIVES.has(property.items?.type), "array items must be a primitive enum");
		}
	}
	assert.deepEqual(requestedSchema.required, [], "nothing is required: rounds submit with unanswered questions");
});

test("recWhy lands in the description, and bodies prepend to it", () => {
	const withWhy = {
		...round,
		questions: [
			{
				id: "deploy",
				question: "Where?",
				body: "Context line.",
				options: [{ label: "a" }, { label: "b" }],
				recommended: "a",
				recWhy: "a is safer",
			},
		],
	};
	const { requestedSchema } = toElicitation(withWhy);
	assert.equal(requestedSchema.properties.deploy.description, "Context line.\n★ a — a is safer");
});

test("toElicitation validates first and throws on invalid rounds", () => {
	assert.throws(() => toElicitation({ ...round, questions: [{ id: "x", question: "?" }] }), /invalid/i);
});
