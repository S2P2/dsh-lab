import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AGREE_LABEL,
	DISAGREE_LABEL,
	ID_PREFIX,
	SKIP_LABEL,
	buildWireQuestions,
	normalizeAnswers,
	validateRoundArgs,
} from "../src/round.js";

/** A fully valid round exercising every question kind. */
const validRound = {
	detail: "Round 3 preamble: settle the card's answer model.",
	progress: { round: 3, decisionsOpen: 8 },
	questions: [
		{
			id: "q1",
			question: "Should unanswered questions block submit?",
			body: "Round atomicity question.",
			options: [
				{ label: "Yes — block until complete" },
				{ label: "No — submit anytime", description: "unanswered flow back" },
			],
			recommended: "No — submit anytime",
			recWhy: "Blocking punishes partial attention.",
		},
		{
			id: "q2",
			question: "Which visual treatments do you accept?",
			options: [{ label: "star badge" }, { label: "prefill" }, { label: "footnote" }],
			recommended: "star badge",
			multi: true,
		},
		{
			id: "q3",
			question: "Describe the accept-all behavior.",
			draft: "Fill every unanswered question with its recommendation; never auto-submit.",
		},
	],
};

test("validateRoundArgs accepts a round covering every question kind", () => {
	const result = validateRoundArgs(validRound);
	assert.equal(result.ok, true);
	assert.deepEqual(result.value.questions.map((q) => q.id), ["q1", "q2", "q3"]);
});

test("validateRoundArgs rejects structural problems", () => {
	const cases = [
		[{ ...validRound, questions: [] }, "empty questions"],
		[{ ...validRound, questions: "nope" }, "questions not an array"],
		[{ ...validRound, detail: "" }, "missing preamble"],
		[{ ...validRound, progress: { round: 0, decisionsOpen: 1 } }, "round zero"],
		[{ ...validRound, progress: { round: 1, decisionsOpen: -1 } }, "negative open decisions"],
		[{ ...validRound, progress: { round: 1.5, decisionsOpen: 0 } }, "non-integer round"],
		[
			{
				...validRound,
				questions: [...validRound.questions, { ...validRound.questions[0] }],
			},
			"duplicate ids",
		],
		[
			{ ...validRound, questions: [{ ...validRound.questions[0], id: `${ID_PREFIX}q1` }] },
			"agent id carrying the wire prefix",
		],
		[
			{ ...validRound, questions: [{ ...validRound.questions[0], question: "" }] },
			"empty question text",
		],
		[
			{
				...validRound,
				questions: [
					{ id: "a", question: "q?", options: [{ label: "only" }], recommended: "only" },
				],
			},
			"fewer than two options",
		],
		[
			{
				...validRound,
				questions: [
					{
						id: "a",
						question: "q?",
						options: [{ label: "x" }, { label: "x" }],
						recommended: "x",
					},
				],
			},
			"duplicate option labels",
		],
		[
			{
				...validRound,
				questions: [
					{ id: "a", question: "q?", options: [{ label: "x" }, { label: "y" }] },
				],
			},
			"choice question without a recommendation",
		],
		[
			{
				...validRound,
				questions: [
					{
						id: "a",
						question: "q?",
						options: [{ label: "x" }, { label: "y" }],
						recommended: "z",
					},
				],
			},
			"recommendation naming an unknown option",
		],
		[
			{
				...validRound,
				questions: [
					{
						id: "a",
						question: "q?",
						options: [{ label: "x" }, { label: "y" }],
						recommended: "x",
						draft: "stray draft",
					},
				],
			},
			"choice question carrying a draft",
		],
		[
			{ ...validRound, questions: [{ id: "a", question: "q?" }] },
			"narrative without a draft",
		],
		[
			{
				...validRound,
				questions: [{ id: "a", question: "q?", draft: "d", multi: true }],
			},
			"multi on a narrative question",
		],
		[
			{
				...validRound,
				questions: [
					{
						id: "a",
						question: "q?",
						options: [{ label: SKIP_LABEL }, { label: "y" }],
						recommended: "y",
					},
				],
			},
			"agent option colliding with the reserved skip label",
		],
		[
			{ ...validRound, extra: true },
			"unknown top-level field",
		],
		[
			{
				...validRound,
				questions: [{ ...validRound.questions[0], extra: true }],
			},
			"unknown question field",
		],
	];
	for (const [args, name] of cases) {
		const result = validateRoundArgs(args);
		assert.equal(result.ok, false, `${name}: expected rejection`);
		assert.ok(result.errors.length > 0, `${name}: expected error messages`);
		assert.ok(
			result.errors.every((e) => typeof e === "string" && e.length > 0),
			`${name}: error messages must be strings`,
		);
	}
});

test("buildWireQuestions mints prefixed ids, verbatim labels, and the multiSelect comment channel", () => {
	const wire = buildWireQuestions(validateRoundArgs(validRound).value);
	assert.equal(wire.length, 3);
	for (const [index, q] of wire.entries()) {
		assert.equal(q.id, ID_PREFIX + validRound.questions[index].id);
		assert.equal(q.multiSelect, true);
		const labels = q.options.map((o) => o.label);
		assert.ok(labels.includes(SKIP_LABEL), "every question offers the wire skip option");
		assert.equal(new Set(labels).size, labels.length, "wire labels stay unique");
	}
	// Choice: agent options verbatim (same objects), skip appended last.
	assert.deepEqual(wire[0].options.slice(0, 2), validRound.questions[0].options);
	assert.equal(wire[0].options.at(-1).label, SKIP_LABEL);
	// Draft narrative: agree/disagree as the two wire options plus skip.
	assert.deepEqual(
		wire[2].options.map((o) => o.label),
		[AGREE_LABEL, DISAGREE_LABEL, SKIP_LABEL],
	);
	// Round preamble rides the first question's detail; bodies ride their own.
	assert.ok(wire[0].detail.includes(validRound.detail));
	assert.ok(wire[0].detail.includes(validRound.questions[0].body));
	assert.equal(wire[1].detail, validRound.questions[1].body ?? undefined);
	assert.equal(wire[2].detail, validRound.questions[2].body ?? undefined);
});

test("normalizeAnswers types every wire answer and strips the prefix", () => {
	const answers = normalizeAnswers([
		{ id: `${ID_PREFIX}q1`, selected: ["No — submit anytime"] },
		{ id: `${ID_PREFIX}q2`, selected: ["star badge", "prefill"], custom: "  both feel fine  " },
		{ id: `${ID_PREFIX}q3`, selected: [AGREE_LABEL] },
	]);
	assert.deepEqual(answers, {
		answers: [
			{ id: "q1", status: "answered", selected: ["No — submit anytime"] },
			{ id: "q2", status: "answered", selected: ["star badge", "prefill"], custom: "both feel fine" },
			{ id: "q3", status: "answered", selected: [AGREE_LABEL] },
		],
	});
});

test("normalizeAnswers marks skip, unanswered, disagree-with-comment, and comment-only", () => {
	const answers = normalizeAnswers([
		{ id: `${ID_PREFIX}q1`, selected: [SKIP_LABEL] },
		{ id: `${ID_PREFIX}q2`, selected: [] },
		{ id: `${ID_PREFIX}q3`, selected: [DISAGREE_LABEL], custom: "Too optimistic" },
	]).answers;
	assert.deepEqual(answers[0], { id: "q1", status: "skipped", selected: [] });
	assert.deepEqual(answers[1], { id: "q2", status: "unanswered", selected: [] });
	assert.deepEqual(answers[2], {
		id: "q3",
		status: "answered",
		selected: [DISAGREE_LABEL],
		custom: "Too optimistic",
	});
	const commentOnly = normalizeAnswers([
		{ id: "q1", selected: [], custom: "my own words" },
	]).answers[0];
	assert.deepEqual(commentOnly, {
		id: "q1",
		status: "answered",
		selected: [],
		custom: "my own words",
	});
});

test("skip takes precedence over simultaneous selections the wire should never send", () => {
	const [a] = normalizeAnswers([
		{ id: "q1", selected: [SKIP_LABEL, "No — submit anytime"], custom: "noise" },
	]).answers;
	assert.deepEqual(a, { id: "q1", status: "skipped", selected: [] });
});

test("normalizeAnswers tolerates defensive inputs: unprefixed ids and empty strings", () => {
	const [a, b] = normalizeAnswers([
		{ id: "q1", selected: ["x"] },
		{ id: "q2", selected: [], custom: "" },
	]).answers;
	assert.deepEqual(a, { id: "q1", status: "answered", selected: ["x"] });
	assert.deepEqual(b, { id: "q2", status: "unanswered", selected: [] });
});
