/**
 * Pure grilling-round domain: agent args validation, wire-question mapping,
 * and answer normalization. No DSH imports — this module is the seam the
 * tool-seam tests target and the vocabulary CONTEXT.md pins (Round,
 * Recommendation, Draft, Comment).
 *
 * Wire facts this module encodes (verified against dsh@0.1.1-rc.2):
 * - `matchesQuestions` (dsh-host-apiproxy/lib/index.js) validates answers
 *   label-exact, one per question, in order; `selected` + `custom` may
 *   coexist only when the question is declared `multiSelect: true`, and a
 *   `custom` that trims to empty is rejected. Hence every grilling question
 *   rides the wire as multiSelect (ADR 0001's comment-channel trick).
 * - The wire has no request-level preamble, so the Round's `detail` rides
 *   the first question's per-question `detail` (rendered by the generic
 *   fallback card too).
 * - Skip is a real wire option (the only carrier the stock wire offers for a
 *   three-state result); the host reserves its label and the card renders it
 *   as the skip affordance instead of a chip.
 */

/** Wire-id prefix: the composer-takeover key (ADR 0001). */
export const ID_PREFIX = "grill:";
/** Reserved wire option carrying an explicit skip. */
export const SKIP_LABEL = "Skip this question";
/** The Draft verdict options minted for narrative questions (issue #2). */
export const AGREE_LABEL = "✓ Agree with this draft";
export const DISAGREE_LABEL = "✗ Disagree";

const QUESTION_FIELDS = new Set([
	"id",
	"question",
	"body",
	"options",
	"recommended",
	"recWhy",
	"draft",
	"multi",
]);
const OPTION_FIELDS = new Set(["label", "description"]);
const ROUND_FIELDS = new Set(["questions", "detail", "progress"]);
const PROGRESS_FIELDS = new Set(["round", "decisionsOpen"]);

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isInteger = (v) => typeof v === "number" && Number.isInteger(v);

/**
 * Validate grill_round tool args against the issue #2 contract:
 * unique ids; ≥2 options on choice questions; a Recommendation (option pick
 * or prose Draft) on every question; round preamble and frontier progress.
 *
 * @param {unknown} args - raw tool args, however malformed.
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
export function validateRoundArgs(args) {
	const errors = [];
	if (!isPlainObject(args)) return { ok: false, errors: ["round must be an object"] };
	for (const key of Object.keys(args)) {
		if (!ROUND_FIELDS.has(key)) errors.push(`unknown field "${key}" (questions, detail, progress)`);
	}
	if (!isNonEmptyString(args.detail)) errors.push("detail (the round preamble) must be a non-empty string");
	if (!isPlainObject(args.progress)) {
		errors.push("progress must be { round, decisionsOpen }");
	} else {
		for (const key of Object.keys(args.progress)) {
			if (!PROGRESS_FIELDS.has(key)) errors.push(`progress has unknown field "${key}"`);
		}
		if (!isInteger(args.progress.round) || args.progress.round < 1) {
			errors.push("progress.round must be an integer ≥ 1");
		}
		if (!isInteger(args.progress.decisionsOpen) || args.progress.decisionsOpen < 0) {
			errors.push("progress.decisionsOpen must be an integer ≥ 0");
		}
	}
	if (!Array.isArray(args.questions) || args.questions.length === 0) {
		errors.push("questions must be a non-empty array");
		return { ok: false, errors };
	}
	const seenIds = new Set();
	for (const [index, q] of args.questions.entries()) {
		const at = `questions[${index}]`;
		if (!isPlainObject(q)) {
			errors.push(`${at} must be an object`);
			continue;
		}
		for (const key of Object.keys(q)) {
			if (!QUESTION_FIELDS.has(key)) {
				errors.push(`${at} has unknown field "${key}"`);
			}
		}
		if (!isNonEmptyString(q.id)) {
			errors.push(`${at}.id must be a non-empty string`);
		} else if (q.id.startsWith(ID_PREFIX)) {
			errors.push(`${at}.id must not already start with "${ID_PREFIX}" (the host adds it)`);
		} else if (seenIds.has(q.id)) {
			errors.push(`${at}.id "${q.id}" is used more than once`);
		} else {
			seenIds.add(q.id);
		}
		if (!isNonEmptyString(q.question)) {
			errors.push(`${at}.question must be a non-empty string`);
		}
		if (q.body !== undefined && !isNonEmptyString(q.body)) {
			errors.push(`${at}.body must be a non-empty string when present`);
		}
		if (q.recWhy !== undefined && !isNonEmptyString(q.recWhy)) {
			errors.push(`${at}.recWhy must be a non-empty string when present`);
		}
		const isChoice = q.options !== undefined;
		if (isChoice) {
			if (!Array.isArray(q.options) || q.options.length < 2) {
				errors.push(`${at}.options must carry at least two options`);
			} else {
				const labels = new Set();
				for (const [oIndex, option] of q.options.entries()) {
					if (!isPlainObject(option)) {
						errors.push(`${at}.options[${oIndex}] must be an object`);
						continue;
					}
					for (const key of Object.keys(option)) {
						if (!OPTION_FIELDS.has(key)) {
							errors.push(`${at}.options[${oIndex}] has unknown field "${key}"`);
						}
					}
					if (!isNonEmptyString(option.label)) {
						errors.push(`${at}.options[${oIndex}].label must be a non-empty string`);
					} else if (option.label === SKIP_LABEL) {
						errors.push(`${at}.options[${oIndex}].label "${SKIP_LABEL}" is reserved`);
					} else if (labels.has(option.label)) {
						errors.push(`${at}.options has duplicate label "${option.label}"`);
					} else {
						labels.add(option.label);
					}
					if (option.description !== undefined && !isNonEmptyString(option.description)) {
						errors.push(`${at}.options[${oIndex}].description must be non-empty when present`);
					}
				}
			}
			if (!isNonEmptyString(q.recommended)) {
				errors.push(`${at} is a choice question and must recommend one option (recommended: label)`);
			} else if (
				Array.isArray(q.options) &&
				!q.options.some((o) => isPlainObject(o) && o.label === q.recommended)
			) {
				errors.push(`${at}.recommended "${q.recommended}" names no option of this question`);
			}
			if (q.draft !== undefined) {
				errors.push(`${at} carries draft: drafts belong to narrative (optionless) questions`);
			}
			if (q.multi !== undefined && typeof q.multi !== "boolean") {
				errors.push(`${at}.multi must be a boolean when present`);
			}
		} else {
			if (!isNonEmptyString(q.draft)) {
				errors.push(`${at} is a narrative question and must carry its Recommendation as draft`);
			}
			if (q.recommended !== undefined) {
				errors.push(`${at} carries recommended: narratives recommend through draft`);
			}
			if (q.multi !== undefined) {
				errors.push(`${at} carries multi: multi-select applies to choice questions`);
			}
		}
	}
	return errors.length > 0 ? { ok: false, errors } : { ok: true, value: args };
}

/**
 * Map validated round args to wire questions for `ctx.userQuestions.ask`.
 *
 * Every question is declared multiSelect (choice + Comment coexist legally),
 * option labels ride verbatim (host validation is label-exact), and the
 * reserved skip option is appended so an explicit skip survives the wire.
 *
 * @param {object} round - validated round args.
 * @returns {Array<{id: string, question: string, detail?: string,
 *   options: Array<{label: string, description?: string}>, multiSelect: true}>}
 */
export function buildWireQuestions(round) {
	return round.questions.map((q, index) => {
		const options = Array.isArray(q.options)
			? [...q.options.map((o) => ({ ...o }))]
			: q.draft !== undefined
				? [{ label: AGREE_LABEL }, { label: DISAGREE_LABEL }]
				: [];
		options.push({ label: SKIP_LABEL });
		const detail = [index === 0 ? round.detail : null, q.body ?? null]
			.filter(Boolean)
			.join("\n\n");
		return {
			id: ID_PREFIX + q.id,
			question: q.question,
			...(detail !== "" ? { detail } : {}),
			options,
			multiSelect: true,
		};
	});
}

/**
 * Normalize wire answers back for the agent: strip the id prefix, type each
 * answer (answered / skipped / unanswered), trim comments, and drop empty
 * fields. Skip precedence: a skip label in `selected` wins outright, matching
 * what the card sends (skip clears choices and the comment).
 *
 * @param {Array<{id: string, selected: string[], custom?: string}>} wireAnswers
 * @returns {{answers: Array<{id: string, status: string, selected: string[], custom?: string}>}}
 */
export function normalizeAnswers(wireAnswers) {
	const answers = wireAnswers.map((answer) => {
		const id = answer.id.startsWith(ID_PREFIX) ? answer.id.slice(ID_PREFIX.length) : answer.id;
		const selected = Array.isArray(answer.selected) ? answer.selected : [];
		const custom = typeof answer.custom === "string" ? answer.custom.trim() : "";
		if (selected.includes(SKIP_LABEL)) {
			return { id, status: "skipped", selected: [] };
		}
		if (selected.length === 0 && custom === "") {
			return { id, status: "unanswered", selected: [] };
		}
		return {
			id,
			status: "answered",
			selected,
			...(custom !== "" ? { custom } : {}),
		};
	});
	return { answers };
}
