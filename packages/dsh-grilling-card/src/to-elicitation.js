/**
 * MCP elicitation mapping: every valid round serializes to exactly one
 * 2026-07-28 form-mode elicitation request
 * (https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation).
 *
 * DSH itself has no MCP elicitation support — "compatible" means losslessly
 * mappable, verified by test: options become enums, multi-select becomes an
 * array of enum items, and Drafts/recommended options land in `default`
 * (the spec's home for pre-filled values). The 2025-06-18 subset has no
 * home for recommendations, hence the 2026-07-28 target.
 */
import { validateRoundArgs } from "./round.js";

/** Join the context lines that precede a property's recommendation marker. */
function describeQuestion(question) {
	const lines = [];
	if (question.body !== undefined) lines.push(question.body);
	const star =
		question.options !== undefined
			? `★ ${question.recommended}${(() => {
					if (question.recWhy !== undefined) return ` — ${question.recWhy}`;
					const hit = question.options.find((o) => o.label === question.recommended);
					return hit?.description !== undefined ? ` — ${hit.description}` : "";
				})()}`
			: `★ draft — ${question.draft}`;
	lines.push(star);
	return lines.join("\n");
}

/**
 * Serialize validated round args to one elicitation form request.
 *
 * @param {object} round - grill_round args (validated here; throws otherwise).
 * @returns {{mode: "form", message: string, requestedSchema: object}}
 */
export function toElicitation(round) {
	const validated = validateRoundArgs(round);
	if (!validated.ok) {
		throw new Error(`round invalid, cannot map to an elicitation form:\n- ${validated.errors.join("\n- ")}`);
	}
	const properties = {};
	for (const question of validated.value.questions) {
		const base = {
			title: question.question,
			description: describeQuestion(question),
		};
		if (question.options !== undefined) {
			const labels = question.options.map((option) => option.label);
			if (question.multi === true) {
				properties[question.id] = {
					...base,
					type: "array",
					items: { type: "string", enum: labels },
					default: [question.recommended],
				};
			} else {
				properties[question.id] = {
					...base,
					type: "string",
					enum: labels,
					default: question.recommended,
				};
			}
		} else {
			properties[question.id] = {
				...base,
				type: "string",
				default: question.draft,
			};
		}
	}
	return {
		mode: "form",
		message: validated.value.detail,
		requestedSchema: {
			type: "object",
			properties,
			required: [],
		},
	};
}
