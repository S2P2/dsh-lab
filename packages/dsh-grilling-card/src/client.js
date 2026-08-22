/**
 * dsh-grilling-card browser half (hand-authored lazy-CJS bundle — the
 * quota-bar precedent; the tsdown client preset is not published and this
 * package value-imports no shipped chrome, per the bundle-purity gate).
 *
 * Two contributions:
 * 1. `conversation.composer` chain entry at priority -1 whose selector
 *    claims only `grill:`-prefixed question batches (ADR 0001) and renders
 *    the live Grilling Card (hybrid "D" from the validated prototype:
 *    full round overview left, one focused editor right).
 * 2. `tool.call.toolview` keyed `grill_round` — the Recorded Round: a flat
 *    read-only worksheet of questions, recommendations, answers and
 *    comments (prototype A layout), the transcript-readability fix.
 *
 * Recommendation metadata (stars, rationale, drafts, meter) travels in the
 * tool args; the live card joins the wire questions to the running
 * grill_round call's args by question id, reading the call block from the
 * session projection the composer owner props carry.
 */
window.__ModuleLoader__.load({
	id: "@s2p2/dsh-grilling-card",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;

		/* ---------------- constants ---------------- */

		const PREFIX = "grill:";
		const CSS_TAG = "@s2p2/dsh-grilling-card/styles";

		/* ---------------- stylesheet (own chrome, DSW tokens with fallbacks) ---------------- */

		const CSS = `
.s2p2g-frame{padding:6px calc(var(--dsh-composer-side-clearance, 16px) + 16px) 10px;justify-content:center;display:flex}
.s2p2g-card{width:100%;max-width:var(--dsh-chat-content-width, 748px);border:1px solid var(--dsw-alias-border-l2, #2a3040);background:var(--dsw-specific-input-major, #161a22);max-height:min(75vh,720px);box-shadow:var(--dsw-shadow-lv2, 0 4px 16px #0006);color:var(--dsw-alias-label-primary, #e6e9ef);border-radius:20px;flex-direction:column;display:flex;overflow:hidden}
.s2p2g-card,.s2p2g-card *{box-sizing:border-box}
.s2p2g-head{flex-shrink:0;align-items:flex-start;gap:16px;padding:18px 16px 0 24px;display:flex}
.s2p2g-eyebrow{color:var(--dsw-alias-label-tertiary, #98a1b3);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.s2p2g-title{margin:2px 0 10px;font-size:16px;font-weight:600;line-height:22px}
.s2p2g-meter{color:var(--dsw-alias-label-secondary, #98a1b3);font-size:12px;line-height:18px;margin:0 0 12px}
.s2p2g-meter b{color:var(--dsw-alias-state-warn-primary, #fbbf24);font-weight:600}
.s2p2g-headact{flex-shrink:0;align-items:center;gap:4px;display:flex}
.s2p2g-iconbtn{width:24px;height:24px;color:var(--dsw-alias-label-tertiary, #98a1b3);cursor:pointer;background:0 0;border:none;border-radius:999px;place-items:center;padding:0;display:grid;font-size:13px;line-height:1}
.s2p2g-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, #ffffff14);color:var(--dsw-alias-label-primary, #e6e9ef)}
.s2p2g-iconbtn:disabled{opacity:.5;cursor:default}
.s2p2g-preamble{flex-shrink:0;color:var(--dsw-alias-label-secondary, #98a1b3);font-size:13px;line-height:20px;padding:0 24px 12px;white-space:pre-wrap}
.s2p2g-split{display:grid;grid-template-columns:1.15fr 1fr;min-height:0;flex:1;border-top:1px solid var(--dsw-alias-border-l2, #2a3040)}
.s2p2g-left{border-right:1px solid var(--dsw-alias-border-l2, #2a3040);overflow-y:auto;padding:6px 0}
.s2p2g-qitem{padding:11px 14px;cursor:pointer;border-left:3px solid transparent;text-align:left;background:none;border-top:none;border-right:none;border-bottom:none;color:inherit;font:inherit;width:100%}
.s2p2g-qitem:hover{background:var(--dsw-alias-interactive-bg-hover, #ffffff0a)}
.s2p2g-qitem.sel{border-left-color:var(--dsw-alias-state-business-primary, #4f8cff);background:color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f8cff) 10%, transparent)}
.s2p2g-qtitle{margin:0 0 4px;font-size:13px;font-weight:600;line-height:18px;display:flex;align-items:baseline;gap:7px}
.s2p2g-qnum{color:var(--dsw-alias-label-caption, #6b7386);font-weight:500;font-size:11px;flex:none}
.s2p2g-dot{width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--dsw-alias-border-l2, #2a3040);flex:none;align-self:center}
.s2p2g-dot.answered{background:var(--dsw-alias-state-success-primary, #34d399)}
.s2p2g-dot.skipped{background:var(--dsw-alias-state-warn-primary, #fbbf24)}
.s2p2g-dot.cur{background:var(--dsw-alias-state-business-primary, #4f8cff)}
.s2p2g-chips{display:flex;flex-wrap:wrap;gap:4px;margin:3px 0}
.s2p2g-chip{border:1px solid var(--dsw-alias-border-l2, #2a3040);border-radius:999px;padding:1px 9px;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary, #98a1b3)}
.s2p2g-chip.on{border-color:var(--dsw-alias-state-success-primary, #34d399);color:var(--dsw-alias-state-success-primary, #34d399);background:color-mix(in srgb, var(--dsw-alias-state-success-primary, #34d399) 12%, transparent)}
.s2p2g-chip .star{color:var(--dsw-alias-state-warn-primary, #fbbf24);margin-right:3px}
.s2p2g-qnote{color:var(--dsw-alias-state-success-primary, #34d399);font-size:11.5px;margin:2px 0 0}
.s2p2g-qnote.skip{color:var(--dsw-alias-state-warn-primary, #fbbf24)}
.s2p2g-right{padding:16px 18px 12px;display:flex;flex-direction:column;min-height:0;overflow-y:auto}
.s2p2g-eq{margin:0 0 4px;font-size:15px;font-weight:600;line-height:21px}
.s2p2g-eb{color:var(--dsw-alias-label-secondary, #98a1b3);font-size:12.5px;line-height:18px;margin:0 0 12px;white-space:pre-wrap}
.s2p2g-opts{display:flex;flex-direction:column;gap:7px;margin-bottom:12px}
.s2p2g-opt{border:1px solid var(--dsw-alias-border-l2, #2a3040);background:var(--dsw-alias-bg-base, #0f1115);color:var(--dsw-alias-label-primary, #e6e9ef);border-radius:10px;padding:8px 13px;font:inherit;font-size:13.5px;cursor:pointer;text-align:left;display:flex;align-items:baseline;gap:8px}
.s2p2g-opt:hover{border-color:var(--dsw-alias-state-business-primary, #4f8cff)}
.s2p2g-opt.sel{border-color:var(--dsw-alias-state-business-primary, #4f8cff);background:color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f8cff) 12%, transparent)}
.s2p2g-opt .star{color:var(--dsw-alias-state-warn-primary, #fbbf24);flex:none}
.s2p2g-opt .box{flex:none;align-self:center;color:var(--dsw-alias-label-secondary, #98a1b3)}
.s2p2g-optdesc{display:block;color:var(--dsw-alias-label-caption, #6b7386);font-size:11.5px;margin-top:2px}
.s2p2g-draftlabel{color:var(--dsw-alias-label-caption, #6b7386);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.s2p2g-draft{border-left:3px solid var(--dsw-alias-state-business-primary, #4f8cff);background:var(--dsw-alias-bg-base, #0f1115);padding:9px 11px;border-radius:8px;margin:0 0 10px;white-space:pre-wrap;font-size:13px;line-height:19px}
.s2p2g-recwhy{color:var(--dsw-alias-label-secondary, #98a1b3);font-size:12px;line-height:17px;margin:2px 0 12px}
.s2p2g-recwhy b{color:var(--dsw-alias-state-warn-primary, #fbbf24);font-weight:600}
.s2p2g-lab{color:var(--dsw-alias-label-caption, #6b7386);font-size:10.5px;margin-bottom:4px}
.s2p2g-cmt{width:100%;min-height:64px;resize:vertical;background:var(--dsw-alias-bg-base, #0f1115);color:var(--dsw-alias-label-primary, #e6e9ef);border:1px solid var(--dsw-alias-border-l2, #2a3040);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px;line-height:19px}
.s2p2g-cmt:focus{outline:none;border-color:var(--dsw-alias-state-business-primary, #4f8cff)}
.s2p2g-editfoot{margin-top:auto;padding-top:10px;display:flex;gap:8px;align-items:center}
.s2p2g-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2, #2a3040);background:var(--dsw-alias-bg-base, #0f1115);color:var(--dsw-alias-label-primary, #e6e9ef);border-radius:10px;padding:7px 14px;font:inherit;font-size:13.5px;cursor:pointer}
.s2p2g-btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary, #4f8cff)}
.s2p2g-btn:disabled{opacity:.5;cursor:default}
.s2p2g-btn.primary{background:var(--dsw-alias-button-info-fill, #4f8cff);border-color:transparent;color:#fff;font-weight:600}
.s2p2g-btn.ghost{background:none;border-color:transparent;color:var(--dsw-alias-label-secondary, #98a1b3)}
.s2p2g-btn.ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary, #e6e9ef)}
.s2p2g-skiplink{background:none;border:none;color:var(--dsw-alias-label-caption, #6b7386);font-size:11.5px;cursor:pointer;padding:4px 0;text-decoration:underline dotted}
.s2p2g-skiplink:hover{color:var(--dsw-alias-state-warn-primary, #fbbf24)}
.s2p2g-foot{flex-shrink:0;display:flex;align-items:center;gap:10px;padding:11px 16px;border-top:1px solid var(--dsw-alias-border-l2, #2a3040);background:var(--dsw-alias-bg-base, #0f1115)}
.s2p2g-count{color:var(--dsw-alias-label-secondary, #98a1b3);font-size:12px;margin-left:auto}
.s2p2g-err{flex-shrink:0;color:var(--dsw-alias-state-error-primary, #f87171);font-size:12px;padding:6px 16px 0}
.s2p2g-busy{color:var(--dsw-alias-label-caption, #6b7386);font-size:12px}
.s2p2g-rec-card{border:1px solid var(--dsw-alias-border-l2, #2a3040);border-radius:12px;overflow:hidden;background:var(--dsw-specific-input-major, #161a22);color:var(--dsw-alias-label-primary, #e6e9ef)}
.s2p2g-rec-head{padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l2, #2a3040)}
.s2p2g-rec-title{margin:2px 0 4px;font-size:14px;font-weight:600}
.s2p2g-rec-row{padding:11px 16px;border-bottom:1px solid var(--dsw-alias-border-l2-darkmode-thin, #21262d)}
.s2p2g-rec-row:last-of-type{border-bottom:none}
.s2p2g-verdict{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-top:4px;font-size:12.5px}
.s2p2g-verdict .pick{font-weight:600}
.s2p2g-match{color:var(--dsw-alias-state-success-primary, #34d399);font-size:11.5px}
.s2p2g-differ{color:var(--dsw-alias-state-warn-primary, #fbbf24);font-size:11.5px}
.s2p2g-quote{color:var(--dsw-alias-label-secondary, #98a1b3);font-size:12px}
.s2p2g-rec-foot{padding:9px 16px;color:var(--dsw-alias-state-success-primary, #34d399);font-size:12px}
.s2p2g-rowline{display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2, #2a3040);border-radius:8px;color:var(--dsw-alias-label-secondary, #98a1b3);font-size:12.5px}
.s2p2g-rowline .pulse{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary, #4f8cff);animation:s2p2gpulse 1.2s ease-in-out infinite alternate}
@keyframes s2p2gpulse{0%{opacity:.35}to{opacity:1}}
@media (max-width: 860px){.s2p2g-split{grid-template-columns:1fr}.s2p2g-left{max-height:220px;border-right:none;border-bottom:1px solid var(--dsw-alias-border-l2, #2a3040)}}
`;
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/* ---------------- shared join: wire questions x tool args ---------------- */

		const stripId = (id) => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id);

		function parseArgsRaw(argsRaw) {
			try {
				const parsed = JSON.parse(argsRaw);
				return parsed && typeof parsed === "object" && Array.isArray(parsed.questions) ? parsed : null;
			} catch {
				return null;
			}
		}

		/**
		 * Find the newest grill_round tool-call block in the session projection
		 * whose args name exactly these wire questions (stripped ids). The
		 * composer owner props carry the session snapshot; its nodes hold the
		 * frozen call block with argsRaw — where the Recommendation metadata
		 * rides (ADR 0001).
		 */
		function joinRound(wireQuestions, session) {
			const wanted = new Set(wireQuestions.map((q) => stripId(q.id)));
			const nodes = Array.isArray(session?.nodes) ? session.nodes : [];
			for (let i = nodes.length - 1; i >= 0; i--) {
				const node = nodes[i];
				if (node?.kind !== "tool-call" || !node.data?.root) continue;
				const block = node.data.root;
				const name = block.kind === "tool-result" ? block.call?.name : block.name;
				if (name !== "grill_round") continue;
				const args = parseArgsRaw(block.kind === "tool-result" ? block.call?.argsRaw : block.argsRaw);
				if (!args) continue;
				const ids = args.questions.map((q) => q.id);
				if (ids.length === wanted.size && ids.every((id) => wanted.has(id))) return args;
			}
			return null;
		}

		/**
		 * One model question: wire shape + joined metadata + derived wire
		 * roles (agree/disagree/skip labels). Works degraded (args = null):
		 * the wire alone still renders options and the comment channel; the
		 * skip affordance degrades to "clear".
		 */
		function modelQuestion(wire, args, index, total) {
			const arg = args ? args.questions.find((q) => q.id === stripId(wire.id)) : undefined;
			const wireLabels = (wire.options ?? []).map((o) => o.label);
			let kind = "wire";
			let agentLabels = null;
			let skipLabel = null;
			let agreeLabel = null;
			let disagreeLabel = null;
			if (arg && Array.isArray(arg.options)) {
				kind = arg.multi === true ? "multi" : "choice";
				agentLabels = new Set(arg.options.map((o) => o.label));
				const extras = wireLabels.filter((l) => !agentLabels.has(l));
				skipLabel = extras[0] ?? null;
			} else if (arg && typeof arg.draft === "string") {
				kind = "draft";
				agreeLabel = wireLabels[0] ?? null;
				disagreeLabel = wireLabels[1] ?? null;
				skipLabel = wireLabels[2] ?? null;
			} else {
				// Degraded (no join) or a defensive draftless narrative.
				skipLabel = wireLabels[wireLabels.length - 1] ?? null;
			}
			return {
				wireId: wire.id,
				id: stripId(wire.id),
				index,
				total,
				question: wire.question,
				body: arg?.body,
				recWhy: arg?.recWhy,
				recommended: arg?.recommended ?? null,
				draft: arg?.draft ?? null,
				multi: arg?.multi === true,
				kind,
				options: (wire.options ?? []).filter((o) => o.label !== skipLabel),
				skipLabel,
				agreeLabel,
				disagreeLabel,
			};
		}

		/* ---------------- live card: hybrid "D" ---------------- */

		function GrillComposer(props) {
			const matched = props.matched;
			return h(
				GrillCard,
				{ key: matched.key, matched, session: props.session },
			);
		}

		function GrillCard({ matched, session }) {
			const wireQuestions = matched.payload.questions;
			const args = React.useMemo(
				() => joinRound(wireQuestions, session),
				[wireQuestions, session],
			);
			const questions = React.useMemo(
				() => wireQuestions.map((w, i) => modelQuestion(w, args, i, wireQuestions.length)),
				[wireQuestions, args],
			);
			const [sel, setSel] = React.useState(0);
			const [answers, setAnswers] = React.useState(() => questions.map(() => ({ picks: [], comment: "", skipped: false })));
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			const [minimized, setMinimized] = React.useState(false);

			const isAnswered = (q, a) =>
				a.skipped || a.picks.length > 0 || a.comment.trim() !== "";
			const answeredCount = questions.filter((q, i) => isAnswered(q, answers[i])).length;

			const update = (i, fn) => {
				setAnswers((cur) => cur.map((a, ai) => (ai === i ? fn(a) : a)));
				setError(null);
			};

			const pick = (q, i, label) => {
				if (q.kind === "multi") {
					update(i, (a) => ({
						...a,
						skipped: false,
						picks: a.picks.includes(label) ? a.picks.filter((l) => l !== label) : [...a.picks, label],
					}));
				} else {
					update(i, (a) => ({ ...a, skipped: false, picks: [label] }));
				}
			};

			const acceptAll = () => {
				setAnswers((cur) =>
					cur.map((a, i) => {
						const q = questions[i];
						if (a.skipped || a.picks.length > 0 || a.comment.trim() !== "") return a;
						if (q.kind === "draft") return { ...a, picks: q.agreeLabel ? [q.agreeLabel] : [] };
						if ((q.kind === "choice" || q.kind === "multi") && q.recommended) {
							return { ...a, picks: q.multi ? [q.recommended] : [q.recommended] };
						}
						return a;
					}),
				);
			};

			const submit = () => {
				const bad = questions.findIndex((q, i) => {
					const a = answers[i];
					return (
						!a.skipped &&
						q.disagreeLabel !== null &&
						a.picks.includes(q.disagreeLabel) &&
						a.comment.trim() === ""
					);
				});
				if (bad >= 0) {
					setSel(bad);
					setError("Disagreeing with a draft needs a comment — tell the agent what's wrong with it.");
					return;
				}
				const payload = {
					ok: true,
					value: {
						sessionId: matched.sessionId,
						answer: {
							answers: questions.map((q, i) => {
								const a = answers[i];
								if (a.skipped && q.skipLabel) {
									return { id: q.wireId, selected: [q.skipLabel] };
								}
								const custom = a.comment.trim();
								return {
									id: q.wireId,
									selected: a.picks,
									...(custom !== "" ? { custom } : {}),
								};
							}),
						},
					},
				};
				setBusy(true);
				setError(null);
				matched.respond(payload).then(
					(receipt) => {
						if (!receipt || receipt.accepted !== true) {
							setBusy(false);
							setError("The host rejected this answer batch" + (receipt && receipt.reason ? ` (${receipt.reason})` : "") + ".");
						}
					},
					(cause) => {
						setBusy(false);
						setError(String((cause && cause.message) || cause));
					},
				);
			};

			const cancel = () => {
				setBusy(true);
				setError(null);
				matched.respond({
					ok: false,
					error: { code: "cancelled", message: "the user dismissed this grilling round", details: {} },
				}).catch(() => {});
			};

			if (minimized) {
				return h(
					"div",
					{ className: "s2p2g-frame" },
					h(
						"div",
						{ className: "s2p2g-card", style: { maxHeight: "none" } },
						h(
							"div",
							{ className: "s2p2g-head" },
							h(
								"div",
								{ style: { flex: "1" } },
								h("div", { className: "s2p2g-eyebrow" }, "Grilling round"),
								h(
									"div",
									{ className: "s2p2g-title", style: { marginBottom: "14px" } },
									`Answer ${answeredCount}/${questions.length} · minimized`,
								),
							),
							h(
								"div",
								{ className: "s2p2g-headact" },
								h("button", { type: "button", className: "s2p2g-iconbtn", title: "Expand", onClick: () => setMinimized(false), disabled: busy }, "▾"),
								h("button", { type: "button", className: "s2p2g-iconbtn", title: "Dismiss the round", onClick: cancel, disabled: busy }, "✕"),
							),
						),
					),
				);
			}

			const q = questions[Math.min(sel, questions.length - 1)];
			const a = answers[Math.min(sel, answers.length - 1)];
			const preamble = wireQuestions[0].detail;

			const chips = (q, a) =>
				h(
					"div",
					{ className: "s2p2g-chips" },
					q.options.map((o) =>
						h(
							"span",
							{
								key: o.label,
								className: "s2p2g-chip" + (a.picks.includes(o.label) ? " on" : ""),
							},
							q.recommended === o.label ? h("span", { className: "star" }, "★") : null,
							q.kind === "multi" ? (a.picks.includes(o.label) ? "☑ " : "☐ ") : "",
							o.label,
						),
					),
					q.kind === "draft"
						? h(
								"span",
								null,
								h("span", { className: "s2p2g-chip" + (q.agreeLabel && a.picks.includes(q.agreeLabel) ? " on" : "") }, "★ ✓ Agree"),
								" ",
								h("span", { className: "s2p2g-chip" + (q.disagreeLabel && a.picks.includes(q.disagreeLabel) ? " on" : "") }, "✗ Disagree"),
							)
						: null,
					q.kind === "wire" ? h("span", { className: "s2p2g-chip" }, "narrative") : null,
				);

			const note = (q, a) => {
				if (a.skipped) return h("div", { className: "s2p2g-qnote skip" }, "skipped");
				if (a.comment.trim() !== "") {
					const text = a.comment.trim();
					return h("div", { className: "s2p2g-qnote" }, `✓ “${text.length > 44 ? text.slice(0, 44) + "…" : text}”`);
				}
				return null;
			};

			const editorOptions = () => {
				if (q.kind === "draft") {
					return h(
						"div",
						null,
						h("div", { className: "s2p2g-draftlabel" }, "agent's draft answer — agree, or push back"),
						h("blockquote", { className: "s2p2g-draft" }, q.draft),
						h(
							"div",
							{ className: "s2p2g-opts" },
							h(
								"button",
								{
									type: "button",
									className: "s2p2g-opt" + (q.agreeLabel && a.picks.includes(q.agreeLabel) ? " sel" : ""),
									disabled: busy,
									onClick: () => pick(q, sel, q.agreeLabel),
								},
								h("span", { className: "star" }, "★"),
								"✓ Agree with this draft",
							),
							h(
								"button",
								{
									type: "button",
									className: "s2p2g-opt" + (q.disagreeLabel && a.picks.includes(q.disagreeLabel) ? " sel" : ""),
									disabled: busy,
									onClick: () => pick(q, sel, q.disagreeLabel),
								},
								h("span", { className: "box" }, "✗"),
								"Disagree",
							),
						),
					);
				}
				if (q.options.length > 0) {
					return h(
						"div",
						{ className: "s2p2g-opts" },
						q.options.map((o) =>
							h(
								"button",
								{
									type: "button",
									key: o.label,
									className: "s2p2g-opt" + (a.picks.includes(o.label) ? " sel" : ""),
									disabled: busy,
									onClick: () => pick(q, sel, o.label),
								},
								q.kind === "multi"
									? h("span", { className: "box" }, a.picks.includes(o.label) ? "☑" : "☐")
									: null,
								q.recommended === o.label ? h("span", { className: "star" }, "★") : null,
								h(
									"span",
									null,
									o.label,
									o.description ? h("span", { className: "s2p2g-optdesc" }, o.description) : null,
								),
							),
						),
					);
				}
				return null;
			};

			return h(
				"div",
				{ className: "s2p2g-frame", "data-grill-key": matched.key },
				h(
					"section",
					{ className: "s2p2g-card", "aria-label": "Grilling round" },
					h(
						"div",
						{ className: "s2p2g-head" },
						h(
							"div",
							{ style: { flex: "1", minWidth: "0" } },
							h("div", { className: "s2p2g-eyebrow" }, "Grilling round"),
							h("h2", { className: "s2p2g-title" }, args ? `Round ${args.progress?.round ?? "?"}` : "Grilling round"),
							args
								? h("div", { className: "s2p2g-meter" }, "round ", h("b", null, args.progress?.round ?? "?"), " · ", h("b", null, args.progress?.decisionsOpen ?? "?"), " decisions open")
								: null,
						),
						h(
							"div",
							{ className: "s2p2g-headact" },
							h("button", { type: "button", className: "s2p2g-iconbtn", title: "Collapse", onClick: () => setMinimized(true), disabled: busy }, "▴"),
							h("button", { type: "button", className: "s2p2g-iconbtn", title: "Dismiss the round", onClick: cancel, disabled: busy }, "✕"),
						),
					),
					preamble
						? h("div", { className: "s2p2g-preamble" }, preamble.split("\n\n")[0])
						: null,
					h(
						"div",
						{ className: "s2p2g-split" },
						h(
							"div",
							{ className: "s2p2g-left" },
							questions.map((qq, i) =>
								h(
									"button",
									{ type: "button", key: qq.wireId, className: "s2p2g-qitem" + (i === sel ? " sel" : ""), onClick: () => setSel(i) },
									h(
										"div",
										{ className: "s2p2g-qtitle" },
										h("span", {
											className:
												"s2p2g-dot" +
												(answers[i].skipped ? " skipped" : isAnswered(qq, answers[i]) ? " answered" : i === sel ? " cur" : ""),
										}),
										h("span", { className: "s2p2g-qnum" }, `Q${i + 1}`),
										qq.question,
									),
									chips(qq, answers[i]),
									note(qq, answers[i]),
								),
							),
						),
						h(
							"div",
							{ className: "s2p2g-right" },
							h("h3", { className: "s2p2g-eq" }, `${sel + 1}. `, q.question),
							q.body ? h("p", { className: "s2p2g-eb" }, q.body) : null,
							editorOptions(),
							q.recWhy
								? h("p", { className: "s2p2g-recwhy" }, h("b", null, "➡️ agent recommends ★"), " — ", q.recWhy)
								: null,
							h("div", { className: "s2p2g-lab" }, q.kind === "draft" ? "correction / comment (optional with Agree, expected with Disagree)" : q.options.length > 0 ? "comment (optional — combines with a choice)" : "your answer"),
							h("textarea", {
								className: "s2p2g-cmt",
								value: a.comment,
								disabled: busy,
								placeholder: q.kind === "draft" ? "What's wrong with the draft?" : q.options.length > 0 ? "Push back, caveat, refine…" : "Your words…",
								onChange: (e) => update(sel, (cur) => ({ ...cur, comment: e.target.value })),
							}),
							h(
								"div",
								{ className: "s2p2g-editfoot" },
								h("button", { type: "button", className: "s2p2g-btn ghost", disabled: busy || sel === 0, onClick: () => setSel(sel - 1) }, "← prev"),
								h("button", { type: "button", className: "s2p2g-btn ghost", disabled: busy || sel === questions.length - 1, onClick: () => setSel(sel + 1) }, "next →"),
								q.skipLabel
									? h(
											"button",
											{
												type: "button",
												className: "s2p2g-skiplink",
												disabled: busy,
												onClick: () => update(sel, (cur) => ({ picks: [], comment: "", skipped: true })),
											},
											"skip this question",
										)
									: h(
											"button",
											{
												type: "button",
												className: "s2p2g-skiplink",
												disabled: busy,
												onClick: () => update(sel, () => ({ picks: [], comment: "", skipped: false })),
											},
											"clear answer",
										),
							),
						),
					),
					error ? h("div", { className: "s2p2g-err", role: "status" }, "⚠ ", error) : null,
					h(
						"div",
						{ className: "s2p2g-foot" },
						h("button", { type: "button", className: "s2p2g-btn", disabled: busy, onClick: acceptAll }, "★ Accept all recommended"),
						h("button", { type: "button", className: "s2p2g-btn primary", disabled: busy, onClick: submit }, busy ? "Submitting…" : "Submit round"),
						h("span", { className: "s2p2g-count" }, `${answeredCount}/${questions.length} answered · unanswered return as “unanswered”`),
					),
				),
			);
		}

		/* ---------------- recorded round: worksheet "A" ---------------- */

		function resultJson(block) {
			try {
				const parsed = JSON.parse(
					(block.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(""),
				);
				return parsed && typeof parsed === "object" && Array.isArray(parsed.answers) ? parsed : null;
			} catch {
				return null;
			}
		}

		function GrillToolview({ block }) {
			const args = React.useMemo(
				() => parseArgsRaw(block.kind === "tool-result" ? block.call?.argsRaw : block.argsRaw),
				[block],
			);
			if (!args) return h("div", { className: "s2p2g-rowline" }, "grill_round");
			if (block.kind !== "tool-result") {
				return h(
					"div",
					{ className: "s2p2g-rowline" },
					h("span", { className: "pulse" }),
					`Grilling round ${args.progress?.round ?? "?"} — waiting for answers…`,
				);
			}
			if (block.isError || block.error) {
				const code = block.error?.code;
				return h(
					"div",
					{ className: "s2p2g-rowline" },
					`Grilling round ${args.progress?.round ?? "?"} — ${code === "ASK_CANCELLED" ? "dismissed by the user" : code === "ASK_ABORTED" ? "interrupted" : "no answer recorded"}.`,
				);
			}
			const parsed = resultJson(block);
			const byId = new Map((parsed?.answers ?? []).map((a) => [a.id, a]));
			const answered = (parsed?.answers ?? []).filter((a) => a.status === "answered").length;
			const skipped = (parsed?.answers ?? []).filter((a) => a.status === "skipped").length;
			return h(
				"div",
				{ className: "s2p2g-rec-card" },
				h(
					"div",
					{ className: "s2p2g-rec-head" },
					h("div", { className: "s2p2g-eyebrow" }, "Grilling round — recorded"),
					h("div", { className: "s2p2g-rec-title" }, `Round ${args.progress?.round ?? "?"} · ${args.progress?.decisionsOpen ?? "?"} decisions open`),
				),
				args.questions.map((q, i) => {
					const answer = byId.get(q.id);
					const status = answer?.status ?? "unanswered";
					const selected = answer?.selected ?? [];
					const custom = answer?.custom;
					const isChoice = Array.isArray(q.options);
					const agree = selected[0] === "✓ Agree with this draft";
					const disagree = selected[0] === "✗ Disagree";
					let verdict;
					if (status === "skipped") verdict = h("span", { className: "s2p2g-differ" }, "skipped");
					else if (isChoice && selected.length === 0 && custom) verdict = h("span", { className: "s2p2g-differ" }, "custom answer");
					else if (selected.length === 0 && !custom) verdict = h("span", { className: "s2p2g-quote" }, "unanswered");
					else if (agree) verdict = h("span", { className: "s2p2g-match" }, "✓ agreed with the agent's draft");
					else if (disagree) verdict = h("span", { className: "s2p2g-differ" }, "✗ disagreed with the draft");
					else if (isChoice) {
						const match =
							q.multi !== true && selected.length === 1 && selected[0] === q.recommended;
						verdict = h(
							"span",
							null,
							h("span", { className: "s2p2g-verdict pick" }, selected.join(" + ")),
							match
								? h("span", { className: "s2p2g-match" }, "✓ matches recommendation")
								: h("span", { className: "s2p2g-differ" }, "≠ differs from recommendation"),
						);
					} else verdict = null;
					return h(
						"div",
						{ key: q.id, className: "s2p2g-rec-row" },
						h(
							"div",
							{ className: "s2p2g-qtitle" },
							h("span", { className: "s2p2g-qnum" }, `Q${i + 1}`),
							q.question,
						),
						q.body ? h("p", { className: "s2p2g-eb" }, q.body) : null,
						isChoice
							? h(
									"div",
									{ className: "s2p2g-chips" },
									q.options.map((o) =>
										h(
											"span",
											{
												key: o.label,
												className: "s2p2g-chip" + (selected.includes(o.label) ? " on" : ""),
											},
											q.recommended === o.label ? h("span", { className: "star" }, "★") : null,
											q.multi === true ? (selected.includes(o.label) ? "☑ " : "☐ ") : "",
											o.label,
										),
									),
								)
							: q.draft
								? h(
										"div",
										null,
										h("div", { className: "s2p2g-draftlabel" }, "agent's draft"),
										h("blockquote", { className: "s2p2g-draft" }, q.draft),
									)
								: null,
						h(
							"div",
							{ className: "s2p2g-verdict" },
							verdict,
							custom ? h("span", { className: "s2p2g-quote" }, `· “${custom}”`) : null,
						),
						q.recWhy
							? h("p", { className: "s2p2g-recwhy" }, h("b", null, "➡️ agent recommended ★"), " — ", q.recWhy)
							: null,
					);
				}),
				h("div", { className: "s2p2g-rec-foot" }, `✓ Round submitted — ${answered} answered · ${skipped} skipped`),
			);
		}

		/* ---------------- registration ---------------- */

		/** Chain routing: claim the composer only for grill: question batches. */
		function selectGrill({ interactions }) {
			const found = (interactions ?? []).find((i) => i && i.kind === "question");
			const questions = found?.payload?.questions;
			if (!Array.isArray(questions) || questions.length === 0) return null;
			return questions.every((q) => typeof q?.id === "string" && q.id.startsWith(PREFIX)) ? found : null;
		}

		exports.inject = ["slots"];
		exports.apply = (ctx) => {
			ctx.slots.inject("conversation.composer", () =>
				ctx.slots.register(
					{ name: "conversation.composer", select: selectGrill, priority: -1 },
					GrillComposer,
				),
			);
			ctx.slots.inject("tool.call.toolview", () =>
				ctx.slots.register({ name: "tool.call.toolview", key: "grill_round" }, GrillToolview),
			);
		};
		return module.exports;
	},
});
