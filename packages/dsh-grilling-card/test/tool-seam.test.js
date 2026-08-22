import assert from "node:assert/strict";
import { test } from "node:test";
import { apply } from "../src/index.js";
import { buildWireQuestions, validateRoundArgs } from "../src/round.js";

const round = {
	detail: "Preamble.",
	progress: { round: 2, decisionsOpen: 5 },
	questions: [
		{
			id: "q1",
			question: "Pick one.",
			options: [{ label: "a" }, { label: "b" }],
			recommended: "a",
		},
		{
			id: "q2",
			question: "Your words?",
			draft: "prose draft",
		},
	],
};

/** Capture the tool a stubbed host registers, with a controllable ask(). */
function mount(ask) {
	let definition;
	const ctx = {
		tools: {
			register(def) {
				definition = def;
				return () => {};
			},
		},
		userQuestions: { ask },
	};
	apply(ctx);
	assert.ok(definition, "the plugin registered a tool");
	assert.equal(definition.name, "grill_round");
	return definition;
}

test("grill_round asks the wire questions and returns typed answers", async () => {
	const seen = [];
	const definition = mount(async (request) => {
		seen.push(request);
		return {
			answers: request.questions.map((q) => ({
				id: q.id,
				selected: [q.options[0].label],
			})),
		};
	});
	const result = await definition.execute(round, { agent: { id: "sess-1" } });
	assert.equal(seen.length, 1);
	assert.deepEqual(seen[0].questions, buildWireQuestions(validateRoundArgs(round).value));
	assert.equal(seen[0].agent.id, "sess-1");
	assert.deepEqual(
		result.answers.map((a) => ({ id: a.id, status: a.status })),
		[
			{ id: "q1", status: "answered" },
			{ id: "q2", status: "answered" },
		],
	);
});

test("invalid args fail before any question is asked", async () => {
	let asked = 0;
	const definition = mount(async () => {
		asked++;
		return { answers: [] };
	});
	await assert.rejects(
		definition.execute({ ...round, questions: [{ id: "x", question: "?" }] }, {}),
		/Recommendation|narrative/i,
	);
	assert.equal(asked, 0, "no wire request may leave the host for invalid args");
});

test("the result renders as one JSON text block", async () => {
	const definition = mount(async (request) => ({
		answers: request.questions.map((q) => ({ id: q.id, selected: [] })),
	}));
	const value = await definition.execute(round, { agent: { id: "s" } });
	const blocks = definition.output.render(round, value);
	assert.deepEqual(blocks, [{ type: "text", text: JSON.stringify(value) }]);
});

/**
 * Transcription of upstream `matchesQuestions` (dsh-host-apiproxy
 * lib/index.js @ 0.1.1-rc.2) — the independent oracle proving the built
 * wire stays answerable through the stock validation the apiproxy runs.
 */
function matchesQuestionsLike(payload, pending) {
	if (payload.sessionId !== pending.sessionId) return false;
	const answers = payload.answer.answers;
	if (answers.length !== pending.questions.length) return false;
	return answers.every((answer, index) => {
		const question = pending.questions[index];
		if (answer.id !== question.id) return false;
		if (new Set(answer.selected).size !== answer.selected.length) return false;
		const custom = answer.custom?.trim();
		if (custom !== undefined && custom === "") return false;
		if (question.multiSelect !== true) {
			if (custom !== undefined && answer.selected.length > 0) return false;
			if (answer.selected.length > 1) return false;
		}
		const labels = new Set(question.options?.map((option) => option.label) ?? []);
		return answer.selected.every((label) => labels.has(label));
	});
}

test("every answer batch the card can send passes stock wire validation", () => {
	const wire = buildWireQuestions(validateRoundArgs(round).value);
	const pending = { sessionId: "s1", questions: wire };
	const batches = [
		// choice + comment, draft disagree + comment, skip
		[
			{ id: "grill:q1", selected: ["a"], custom: "why not" },
			{ id: "grill:q2", selected: ["✗ Disagree"], custom: "too vague" },
		],
		// unanswered (empty) and custom-only answers
		[
			{ id: "grill:q1", selected: [] },
			{ id: "grill:q2", selected: [], custom: "free words" },
		],
		// explicit skips through the reserved option
		[
			{ id: "grill:q1", selected: ["Skip this question"] },
			{ id: "grill:q2", selected: ["✓ Agree with this draft"] },
		],
	];
	for (const answers of batches) {
		const payload = { sessionId: "s1", answer: { answers } };
		assert.equal(
			matchesQuestionsLike(payload, pending),
			true,
			`batch should validate: ${JSON.stringify(answers)}`,
		);
	}
	// Oracle sanity: the checks it exists to mirror really do bite.
	assert.equal(
		matchesQuestionsLike(
			{ sessionId: "s1", answer: { answers: [{ id: "grill:q1", selected: ["A"], custom: "x" }] } },
			{ sessionId: "s1", questions: [{ id: "grill:q1", multiSelect: false, options: [{ label: "A" }] }] },
		),
		false,
		"selected+custom must be illegal without multiSelect",
	);
	assert.equal(
		matchesQuestionsLike(
			{ sessionId: "s1", answer: { answers: [{ id: "grill:q1", selected: ["a"] }] } },
			{ sessionId: "other", questions: wire },
		),
		false,
		"sessionId mismatch must be rejected",
	);
	assert.equal(
		matchesQuestionsLike(
			{ sessionId: "s1", answer: { answers: [{ id: "grill:q1", selected: ["no such label"] }] } },
			pending,
		),
		false,
		"labels must match verbatim",
	);
});
