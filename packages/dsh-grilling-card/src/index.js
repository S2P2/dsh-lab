/**
 * dsh-grilling-card host half: the `grill_round` tool.
 *
 * One grilling Round in, one typed answer batch out (issue #2). The tool
 * calls `ctx.userQuestions.ask` directly — the stock `ask_user_question`
 * tool drops fields our wire needs (`detail`, per-question multiSelect) —
 * and the browser half's composer takeover renders the rich card for the
 * prefixed ids this host mints (ADR 0001). Registration goes through the
 * raw `ctx.tools.register` face so this package stays dependency-free;
 * args validation beyond the JSON-schema subset runs in `execute`.
 */
import { buildWireQuestions, normalizeAnswers, validateRoundArgs } from "./round.js";

export const name = "dsh-grilling-card";
export const inject = ["tools", "userQuestions"];

const parameters = {
	type: "object",
	properties: {
		questions: {
			type: "array",
			description:
				"The round's frontier questions. Choice questions carry options (>=2) and recommended (one option's label, verbatim); narrative questions carry draft (the proposed prose answer). Every question must carry a recommendation.",
			items: {
				type: "object",
				properties: {
					id: {
						type: "string",
						description: "Stable id, unique in this round; echoed in the answer. Must not start with 'grill:'.",
					},
					question: { type: "string", description: "The question itself, one sentence." },
					body: { type: "string", description: "Optional supporting context for the question." },
					options: {
						type: "array",
						description: "The choices (choice questions only). Labels are user-facing and must be unique.",
						items: {
							type: "object",
							properties: {
								label: { type: "string", description: "Short user-facing option label." },
								description: { type: "string", description: "One sentence on the tradeoff." },
							},
							required: ["label"],
							additionalProperties: false,
						},
					},
					recommended: {
						type: "string",
						description: "Choice questions: the recommended option's label, verbatim.",
					},
					recWhy: { type: "string", description: "Why the recommendation is right (rendered with the star)." },
					draft: {
						type: "string",
						description: "Narrative questions: the proposed prose answer the user agrees or disagrees with.",
					},
					multi: { type: "boolean", description: "Choice question: allow selecting several options." },
				},
				required: ["id", "question"],
				additionalProperties: false,
			},
		},
		detail: {
			type: "string",
			description: "Round preamble shown above the round (markdown).",
		},
		progress: {
			type: "object",
			properties: {
				round: { type: "integer", description: "1-based round number." },
				decisionsOpen: { type: "integer", description: "Frontier decisions still open (the meter)." },
			},
			required: ["round", "decisionsOpen"],
			additionalProperties: false,
		},
	},
	required: ["questions", "detail", "progress"],
	additionalProperties: false,
};

const outputSchema = {
	type: "object",
	properties: {
		answers: {
			type: "array",
			required: true,
			items: {
				type: "object",
				properties: {
					id: { type: "string", required: true },
					status: {
						type: "string",
						required: true,
						enum: ["answered", "skipped", "unanswered"],
					},
					selected: {
						type: "array",
						required: true,
						items: { type: "string" },
					},
					custom: { type: "string" },
				},
				additionalProperties: false,
			},
		},
	},
	additionalProperties: false,
};

export function apply(ctx) {
	ctx.tools.register({
		name: "grill_round",
		description:
			"Ask one grilling round: every question ships with your recommendation (a starred option or a prose draft the user can agree/disagree with; disagree requires a comment). The rich card renders recommendations, an accept-all fill, per-question comments, and a frontier meter; the user may submit with questions unanswered or explicitly skipped. Returns answers typed answered|skipped|unanswered per question. Free text is always available as a comment on any question.",
		parameters,
		output: {
			schema: outputSchema,
			render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
		},
		async execute(args, exec) {
			const validated = validateRoundArgs(args);
			if (!validated.ok) {
				throw new Error(`grill_round args invalid:\n- ${validated.errors.join("\n- ")}`);
			}
			const wire = buildWireQuestions(validated.value);
			const { answers } = await ctx.userQuestions.ask({
				questions: wire,
				...exec.agent !== undefined ? { agent: exec.agent } : {},
				...exec.signal !== undefined ? { signal: exec.signal } : {},
			});
			return normalizeAnswers(answers);
		},
	});
}
