// @s2p2/dsh-ask-card — web client plugin.
//
// Shadows the stock ask_user_question transcript row (registered by
// @deepseek-ai/dsh-client-ui-tool into the keyed `tool.call.toolview` slot at
// the default priority) by registering the same key at priority -1; the slot
// system renders the lowest-priority entry. Collapsed, the row replicates the
// stock ToolRow chrome one-to-one (DisclosureRow + the same design tokens).
// Expanded, instead of the generic IN/OUT JSON card it renders a read-only
// question/answer card: every asked question with its options, the choices the
// user made highlighted, recommended badges, custom and skipped answers.
// Anything it cannot parse falls back to the exact stock IN/OUT card, so no
// transcript ever renders worse than stock. The pending-question composer
// takeover (dsh-client-ui-user-questions) is a different slot and is untouched.
window.__ModuleLoader__.load({
	id: "@s2p2/dsh-ask-card",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let jsxRuntime = require("react/jsx-runtime");
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const { jsx, jsxs, Fragment } = jsxRuntime;
		const {
			DisclosureRow,
			StateDot,
			IconCheckOutline14,
			IconInspectOutline12,
			IconQuestionOutline14
		} = primitives;

		/** Tiny classname join (clsx equivalent for this bundle's needs). */
		function cn(...parts) {
			return parts.filter(Boolean).join(" ");
		}

		//#region css
		// Row chrome mirrors the stock ToolRow.module.css (token-for-token, class
		// names re-prefixed); the card styles follow the QuestionComposer look.
		const css = `.kQa29_root{flex-direction:column;display:flex}.kQa29_row{position:relative;overflow:hidden}.kQa29_root[data-state=running] .kQa29_row:after{content:"";background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite kQa29_dsh-ask-card-row-sweep;position:absolute;top:0;bottom:0;left:0}@keyframes kQa29_dsh-ask-card-row-sweep{0%{left:-300px}90%,to{left:100%}}.kQa29_leading{flex-shrink:0}.kQa29_chevron{color:var(--dsw-alias-label-secondary)}.kQa29_title{font-weight:400}.kQa29_sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.kQa29_summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;font-size:14px;line-height:24px;overflow:hidden}.kQa29_errorSummary{color:var(--dsw-alias-state-error-primary)}.kQa29_bodyWrap{flex-direction:column;display:flex}.kQa29_inspectButton{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0;border-radius:999px;align-self:flex-start;align-items:center;gap:4px;margin:4px 0 2px 4px;padding:2px 8px;font-size:11px;line-height:16px;transition:opacity .1s;display:inline-flex}.kQa29_root:hover .kQa29_inspectButton,.kQa29_inspectButton:focus-visible{opacity:1}.kQa29_inspectButton:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}.kQa29_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}
.kQa29_card{border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-l2);color:var(--dsw-alias-label-primary);border-radius:16px;flex-direction:column;margin:4px 0 4px 4px;display:flex;overflow:hidden}
.kQa29_chipRow{flex-shrink:0;align-items:center;gap:8px;padding:12px 16px 0;display:flex}
.kQa29_chip{align-items:center;gap:6px;border-radius:999px;padding:2px 10px;font-size:11px;line-height:16px;display:inline-flex}
.kQa29_chipPending{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary)}
.kQa29_chipOk{background:var(--dsw-alias-state-business-secondary);color:var(--dsh-alias-state-business-primary,var(--dsw-alias-state-business-primary))}
.kQa29_chipOff{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}
.kQa29_chipError{background:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}
.kQa29_qSection{flex-direction:column;gap:8px;padding:12px 16px 2px;display:flex}
.kQa29_qSection:last-child{padding-bottom:14px}
.kQa29_eyebrow{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.kQa29_qTitleRow{align-items:baseline;gap:8px;display:flex}
.kQa29_qTitle{margin:0;min-width:0;font-size:14px;font-weight:500;line-height:22px;overflow-wrap:anywhere}
.kQa29_multiBadge{flex:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:16px}
.kQa29_options{flex-direction:column;gap:6px;display:flex}
.kQa29_option{align-items:flex-start;gap:10px;border:1px solid #0000;border-radius:10px;padding:6px 10px;display:flex;text-align:left}
.kQa29_optionSelected{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-state-business-primary)}
.kQa29_num{color:var(--dsw-alias-label-caption);flex:none;width:16px;height:22px;display:inline-grid;place-items:center;font-size:12px}
.kQa29_optionCopy{flex-direction:column;gap:2px;min-width:0;display:flex}
.kQa29_optionLine{align-items:baseline;gap:8px;display:flex}
.kQa29_optionLabel{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.kQa29_optionLabelMuted{color:var(--dsw-alias-label-secondary)}
.kQa29_badge{flex:none;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-radius:999px;padding:0 8px;font-size:11px;line-height:18px}
.kQa29_optDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.kQa29_checkbox{border:1.5px solid var(--dsw-alias-border-l3);border-radius:4px;width:14px;height:14px;margin-top:4px;flex:none;place-items:center;display:grid;color:#fff}
.kQa29_checkboxChecked{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.kQa29_answerBox{border:1px solid var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:20px;margin:0 0 0 26px;padding:6px 10px}
.kQa29_answerLabel{color:var(--dsw-alias-state-business-primary);font-size:11px;line-height:16px;margin:0 0 0 26px}.kQa29_skippedLabel{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;margin:0 0 0 26px}
.kQa29_errorLine{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:18px;margin:10px 16px 0}
.kQa29_cardEnd{height:12px;flex:none}
.kQa29_ioCard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block-small);border-radius:12px;flex-direction:column;margin:4px 0 4px 4px;display:flex}
.kQa29_ioSection{grid-template-columns:max-content 1fr;align-items:baseline;column-gap:14px;max-height:150px;padding:12px 16px;display:grid;overflow-y:auto}
.kQa29_ioSection::-webkit-scrollbar-thumb{background-clip:padding-box;border:2px solid #0000;border-radius:6px}
.kQa29_ioSection::-webkit-scrollbar-track{margin:6px 0}
.kQa29_ioLabel{color:var(--dsw-alias-label-caption);align-self:start;position:sticky;top:0}
.kQa29_ioDivider{background:var(--dsw-alias-border-l2);flex:none;height:1px}
.kQa29_ioText{white-space:pre-wrap;word-break:break-word;min-width:0;color:var(--dsw-alias-label-secondary)}
.kQa29_ioText[data-error]{color:var(--dsw-alias-state-error-primary)}`;
		const tagId = "@s2p2/dsh-ask-card/AskCardRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@s2p2/dsh-ask-card";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const styles = {
			answerBox: "kQa29_answerBox",
			answerLabel: "kQa29_answerLabel",
			badge: "kQa29_badge",
			bodyWrap: "kQa29_bodyWrap",
			card: "kQa29_card",
			cardEnd: "kQa29_cardEnd",
			checkbox: "kQa29_checkbox",
			checkboxChecked: "kQa29_checkboxChecked",
			chevron: "kQa29_chevron",
			chip: "kQa29_chip",
			chipError: "kQa29_chipError",
			chipOff: "kQa29_chipOff",
			chipOk: "kQa29_chipOk",
			chipPending: "kQa29_chipPending",
			chipRow: "kQa29_chipRow",
			errorLine: "kQa29_errorLine",
			errorSummary: "kQa29_errorSummary",
			eyebrow: "kQa29_eyebrow",
			inspectButton: "kQa29_inspectButton",
			ioCard: "kQa29_ioCard",
			ioDivider: "kQa29_ioDivider",
			ioLabel: "kQa29_ioLabel",
			ioSection: "kQa29_ioSection",
			ioText: "kQa29_ioText",
			leading: "kQa29_leading",
			multiBadge: "kQa29_multiBadge",
			num: "kQa29_num",
			option: "kQa29_option",
			optionCopy: "kQa29_optionCopy",
			optionLabel: "kQa29_optionLabel",
			optionLabelMuted: "kQa29_optionLabelMuted",
			optionLine: "kQa29_optionLine",
			optionSelected: "kQa29_optionSelected",
			options: "kQa29_options",
			optDesc: "kQa29_optDesc",
			qSection: "kQa29_qSection",
			qTitle: "kQa29_qTitle",
			qTitleRow: "kQa29_qTitleRow",
			root: "kQa29_root",
			row: "kQa29_row",
			sep: "kQa29_sep",
			skippedLabel: "kQa29_skippedLabel",
			summary: "kQa29_summary",
			visuallyHidden: "kQa29_visuallyHidden"
		};
		//#endregion

		//#region parse
		/** Split the conventional recommendation suffix without changing the
		 * answer value (same convention the stock QuestionComposer renders). */
		function parseRecommendedLabel(label) {
			const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
			return suffix.test(label) ? { label: label.replace(suffix, ""), recommended: true } : { label, recommended: false };
		}

		function firstLine(text) {
			const index = text.indexOf("\n");
			return index === -1 ? text : text.slice(0, index);
		}

		/** Narrow one args question to the tool contract, or null. */
		function narrowQuestion(value) {
			if (typeof value !== "object" || value === null) return null;
			const { id, question } = value;
			if (typeof id !== "string" || typeof question !== "string") return null;
			const header = typeof value.header === "string" ? value.header : undefined;
			const multi = value.multi_select === true || value.multiSelect === true;
			let options = [];
			if (Array.isArray(value.options)) {
				options = [];
				for (const option of value.options) {
					if (typeof option !== "object" || option === null || typeof option.label !== "string") return null;
					options.push({
						label: option.label,
						description: typeof option.description === "string" ? option.description : undefined
					});
				}
			} else if (value.options !== undefined) return null;
			return { id, question, header, multi, options };
		}

		/** Parse the call's questions off the frozen call slice, or null when the
		 * args are not a valid ask_user_question payload (caller falls back to
		 * the stock IN/OUT card). */
		function questionsOf(block) {
			const argsRaw = ("kind" in block ? block.call?.argsRaw : block.argsRaw) ?? "";
			let parsed;
			try {
				parsed = JSON.parse(argsRaw);
			} catch {
				return null;
			}
			if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
			const questions = [];
			for (const item of parsed.questions) {
				const question = narrowQuestion(item);
				if (question === null) return null;
				questions.push(question);
			}
			return questions;
		}

		/** Parse the settled result's answer batch into a Map by question id, or
		 * null when the result is not a valid answer batch. */
		function answersOf(block) {
			const text = block.content.filter((part) => part.type === "text").map((part) => part.text).join("");
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch {
				return null;
			}
			if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.answers)) return null;
			const map = new Map();
			for (const answer of parsed.answers) {
				if (typeof answer !== "object" || answer === null || typeof answer.id !== "string") return null;
				if (answer.selected !== undefined && !Array.isArray(answer.selected)) return null;
				if (answer.selected !== undefined && !answer.selected.every((item) => typeof item === "string")) return null;
				if (answer.custom !== undefined && typeof answer.custom !== "string") return null;
				map.set(answer.id, {
					selected: answer.selected ?? [],
					custom: typeof answer.custom === "string" && answer.custom !== "" ? answer.custom : undefined
				});
			}
			return map;
		}

		function resultText(block) {
			return block.content.filter((part) => part.type === "text").map((part) => part.text).join("");
		}
		//#endregion

		//#region row chrome
		/** Leading-slot state substitution, mirroring the stock ToolRow. */
		function leadingFor(state, icon) {
			switch (state) {
				case "error": return jsx(StateDot, { state: "error" });
				case "stopped": return jsx(StateDot, { state: "warning" });
				default: return icon;
			}
		}

		function stateStatus(state, t) {
			switch (state) {
				case "running": return t("row.running");
				case "error": return t("row.failed");
				case "stopped": return t("row.stopped");
				default: return null;
			}
		}
		//#endregion

		//#region card
		function chipOf({ done, code, state, answeredCount, total }, t) {
			if (code === "ASK_CANCELLED") return { className: styles.chipOff, text: t("ask.cancelled") };
			if (code === "ASK_ABORTED") return { className: styles.chipOff, text: t("ask.interrupted") };
			if (!done) return { className: styles.chipPending, text: t("ask.waiting") };
			if (state === "error") return { className: styles.chipError, text: t("row.failed") };
			return { className: styles.chipOk, text: t("ask.answered", { answered: answeredCount, total }) };
		}

		function OptionRow({ question, option, optionIndex, selected, t }) {
			const display = parseRecommendedLabel(option.label);
			return jsxs("div", {
				className: cn(styles.option, selected && styles.optionSelected),
				children: [
					question.multi
						? jsx("span", {
							className: cn(styles.checkbox, selected && styles.checkboxChecked),
							"aria-hidden": "true",
							children: selected ? jsx(IconCheckOutline14, { size: 12 }) : null
						})
						: jsx("span", { className: styles.num, children: optionIndex + 1 }),
					jsx("div", {
						className: styles.optionCopy,
						children: [
							jsxs("span", {
								className: styles.optionLine,
								children: [
									jsx("span", { className: styles.optionLabel, children: display.label }),
									display.recommended ? jsx("span", { className: styles.badge, children: t("option.recommended") }) : null
								]
							}),
							option.description !== undefined ? jsx("span", { className: styles.optDesc, children: option.description }) : null
						]
					})
				]
			});
		}

		function QuestionSection({ question, answer, t }) {
			const selected = answer?.selected ?? [];
			return jsxs("div", {
				className: styles.qSection,
				children: [
					question.header !== undefined ? jsx("div", { className: styles.eyebrow, children: question.header }) : null,
					jsxs("div", {
						className: styles.qTitleRow,
						children: [
							jsx("h3", { className: styles.qTitle, children: question.question }),
							question.multi ? jsx("span", { className: styles.multiBadge, children: t("card.multi") }) : null
						]
					}),
					question.options.length > 0
						? jsx("div", {
							className: styles.options,
							children: question.options.map((option, optionIndex) => jsx(OptionRow, {
								question,
								option,
								optionIndex,
								selected: selected.includes(option.label),
								t
							}, `${option.label}-${optionIndex}`))
						})
						: null,
					answer?.custom !== undefined
						? jsxs(Fragment, {
							children: [
								jsx("div", { className: styles.answerLabel, children: t("card.custom") }),
								jsx("div", { className: styles.answerBox, children: answer.custom })
							]
						})
						: null,
					answer !== undefined && answer.custom === undefined && selected.length === 0
						? jsx("div", { className: styles.skippedLabel, children: t("card.skipped") })
						: null
				]
			});
		}

		/** The expanded read-only card; renders only on a valid question payload. */
		function AskCardBody({ questions, answers, chip, errorText, t }) {
			return jsxs("section", {
				className: styles.card,
				children: [
					jsx("div", {
						className: styles.chipRow,
						children: chip === null ? null : jsx("span", { className: cn(styles.chip, chip.className), children: chip.text })
					}),
					...questions.map((question) => jsx(QuestionSection, {
						question,
						answer: answers?.get(question.id),
						t
					}, question.id)),
					errorText !== null ? jsx("div", { className: styles.errorLine, children: errorText }) : null,
					jsx("div", { className: styles.cardEnd })
				]
			});
		}

		/** Stock IN/OUT card, for payloads the card cannot render. */
		function IoBody({ body, output, error }) {
			return jsxs("div", {
				className: styles.ioCard,
				children: [
					body !== null ? jsxs("div", {
						className: styles.ioSection,
						children: [jsx("span", { className: styles.ioLabel, children: "IN" }), jsx("span", { className: styles.ioText, children: body })]
					}) : null,
					body !== null && output !== null ? jsx("span", { className: styles.ioDivider, "aria-hidden": "true" }) : null,
					output !== null ? jsxs("div", {
						className: styles.ioSection,
						children: [jsx("span", { className: styles.ioLabel, children: "OUT" }), jsx("span", { className: styles.ioText, "data-error": error || undefined, children: output })]
					}) : null
				]
			});
		}
		//#endregion

		//#region row
		/**
		 * Drop-in shadow of the stock AskQuestionRow: identical collapsed chrome
		 * and summaries; a question/answer card instead of the IN/OUT JSON when
		 * expanded (falling back to the stock card on any unparseable payload).
		 */
		function AskCardRow({ toolName, block, inspect, t }) {
			const done = "kind" in block;
			const code = done ? block.error?.code : undefined;
			let state = !done ? "running" : block.error?.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok";
			const output = done ? resultText(block) || null : null;
			const questions = questionsOf(block);
			const answers = done && state === "ok" ? answersOf(block) : null;
			const total = questions?.length ?? 0;
			const answered = answers !== null && total > 0
				? questions.filter((question) => {
					const answer = answers.get(question.id);
					return answer !== undefined && (answer.selected.length > 0 || answer.custom !== undefined);
				}).length
				: -1;

			let summary;
			if (code === "ASK_CANCELLED") summary = t("ask.cancelled");
			else if (code === "ASK_ABORTED") {
				summary = t("ask.interrupted");
				state = "stopped";
			} else if (state === "running") summary = t("ask.waiting");
			else if (state === "ok") summary = answered >= 0 ? t("ask.answered", { answered, total }) : output !== null ? firstLine(output) : "";
			else summary = output !== null ? firstLine(output) : "";

			const [expanded, setExpanded] = react.useState(false);
			const cardMode = questions !== null;
			const chip = !cardMode
				? null
				: done && state === "ok" && answers === null
					? null
					: chipOf({ done, code, state, answeredCount: Math.max(answered, 0), total }, t);
			const errorText = cardMode && done && state === "error" && output !== null ? firstLine(output) : null;
			const status = stateStatus(state, t);
			const failureLine = state === "error" ? summary : null;
			const summaryText = failureLine ?? summary;

			const body = cardMode
				? jsx(AskCardBody, { questions, answers: answers ?? undefined, chip, errorText, t })
				: jsx(IoBody, {
					body: ioBodyText(block),
					output,
					error: state === "error"
				});

			return jsxs("div", {
				className: styles.root,
				"data-variant": "others",
				"data-tool": toolName,
				"data-state": state,
				children: [
					status !== null ? jsx("span", { className: styles.visuallyHidden, children: status }) : null,
					jsx(DisclosureRow, {
						rowClassName: styles.row,
						leadingClassName: styles.leading,
						titleClassName: styles.title,
						chevronClassName: styles.chevron,
						icon: leadingFor(state, jsx(IconQuestionOutline14, { size: 14 })),
						title: t("ask.rowTitle"),
						open: expanded,
						expandable: true,
						expandOnRowClick: true,
						keepContentWhenOpen: true,
						onToggle: () => {
							setExpanded((value) => !value);
						},
						collapsedContent: summaryText !== "" && jsxs(Fragment, {
							children: [
								jsx("span", { className: styles.sep, "aria-hidden": "true" }),
								jsx("span", { className: cn(styles.summary, failureLine !== null && styles.errorSummary), children: summaryText })
							]
						}),
						children: jsxs("div", {
							className: styles.bodyWrap,
							children: [
								body,
								inspect !== undefined ? jsxs("button", {
									type: "button",
									className: styles.inspectButton,
									onClick: inspect,
									children: [jsx(IconInspectOutline12, {}), "Inspect"]
								}) : null
							]
						})
					})
				]
			});
		}

		/** Pretty-print the raw args for the fallback IN section (stock deriveBody). */
		function ioBodyText(block) {
			const argsRaw = ("kind" in block ? block.call?.argsRaw : block.argsRaw) ?? "";
			if (argsRaw === "") return null;
			try {
				return JSON.stringify(JSON.parse(argsRaw), null, 2);
			} catch {
				return argsRaw;
			}
		}
		//#endregion

		//#region plugin
		/** Dictionary namespace owned by this plugin (zh is the key-set source). */
		const NS = "askcard";
		const zh = {
			"row.running": "运行中",
			"row.failed": "失败",
			"row.stopped": "已停止",
			"ask.rowTitle": "提问",
			"ask.waiting": "等待回答",
			"ask.cancelled": "已取消",
			"ask.interrupted": "已中断",
			"ask.answered": "{answered}/{total} 已回答",
			"option.recommended": "推荐",
			"card.multi": "可多选",
			"card.custom": "自定义回答",
			"card.skipped": "已跳过"
		};
		const en = {
			"row.running": "Running",
			"row.failed": "Failed",
			"row.stopped": "Stopped",
			"ask.rowTitle": "Ask question",
			"ask.waiting": "waiting",
			"ask.cancelled": "cancelled",
			"ask.interrupted": "interrupted",
			"ask.answered": "{answered}/{total} answered",
			"option.recommended": "Recommended",
			"card.multi": "multi-select",
			"card.custom": "Custom answer",
			"card.skipped": "Skipped"
		};

		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ask-card: dictionaries");
			ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key: "ask_user_question",
				priority: -1,
				locale: NS
			}, AskCardRow));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
