/**
 * Browser half: one profile-wide Preset tab contributed through Better
 * Sidebar's public client service. This hand-authored lazy-CJS bundle keeps
 * dsh-better-sidebar entirely optional: there are no type or runtime imports.
 */
window.__ModuleLoader__.load({
	id: "@s2p2/dsh-preset-authoring",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;

		const TAB_ID = "s2p2:preset";
		const API_PATH = "/dsh-preset-authoring/api";
		const SIDEBAR_RECONCILE_MS = 1_000;
		const SNAPSHOT_POLL_MS = 2_000;
		const CSS_TAG = "@s2p2/dsh-preset-authoring/styles";
		let integrationStatus = Object.freeze({ state: "initializing", message: "Looking for Better Sidebar" });

		const CSS = `
.s2p2p-root,.s2p2p-root *{box-sizing:border-box}.s2p2p-root{height:100%;overflow:auto;padding:12px;color:var(--dsw-alias-label-primary,#e6e9ef);font:13px/1.45 var(--dsw-font-family,sans-serif)}
.s2p2p-head,.s2p2p-row,.s2p2p-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.s2p2p-head{justify-content:space-between;margin-bottom:10px}.s2p2p-title{font-size:16px;font-weight:650}.s2p2p-sub,.s2p2p-meta{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:11px}.s2p2p-label{font-size:11px;color:var(--dsw-alias-label-secondary,#aab2c0);display:block;margin:9px 0 4px}.s2p2p-select,.s2p2p-input{width:100%;min-width:0;background:var(--dsw-alias-bg-base,#101319);color:inherit;border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:7px;padding:6px 8px}.s2p2p-btn{border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:7px;background:var(--dsw-alias-bg-base,#101319);color:inherit;padding:5px 9px;cursor:pointer}.s2p2p-btn:disabled{opacity:.5;cursor:default}.s2p2p-btn.primary{background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff;border-color:transparent}.s2p2p-card{border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:9px;margin:10px 0;background:var(--dsw-alias-bg-layer-1,#161a22);overflow:hidden}.s2p2p-card>summary,.s2p2p-card>h3{padding:8px 10px;margin:0;font-size:12px;font-weight:650}.s2p2p-body{padding:0 10px 10px}.s2p2p-item{padding:8px 0;border-top:1px solid var(--dsw-alias-border-l2,#242936)}.s2p2p-item:first-child{border-top:0}.s2p2p-row{justify-content:space-between}.s2p2p-status{padding:7px 9px;border-radius:7px;background:var(--dsw-alias-bg-base,#101319);white-space:pre-wrap}.s2p2p-status.bad{color:var(--dsw-alias-state-error-primary,#f87171)}.s2p2p-status.warn{color:var(--dsw-alias-state-warn-primary,#fbbf24)}.s2p2p-diff{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.s2p2p-banner{padding:8px;border:1px solid var(--dsw-alias-state-warn-primary,#fbbf24);border-radius:8px;color:var(--dsw-alias-state-warn-primary,#fbbf24);margin:8px 0}.s2p2p-empty{padding:20px 8px;text-align:center;color:var(--dsw-alias-label-tertiary,#8b949e)}
`;
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function createTransport() {
			return Object.freeze({
				async command(command, scope = {}) {
					const response = await fetch(API_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						cache: "no-store",
						body: JSON.stringify({
							sessionId: scope.sessionId,
							...(scope.cwd === undefined ? {} : { cwd: scope.cwd }),
							command,
						}),
					});
					let payload;
					try { payload = await response.json(); } catch { payload = null; }
					if (!response.ok || payload?.ok === false) {
						const diagnostic = payload?.error || payload?.diagnostic || {};
						const error = Object.assign(new Error(diagnostic.message || `Preset authoring request failed (${response.status})`), diagnostic.code ? { code: diagnostic.code } : {});
						throw error;
					}
					return payload && Object.prototype.hasOwnProperty.call(payload, "value") ? payload.value : payload;
				},
			});
		}

		function valueText(value) {
			if (value === null || value === undefined || value === "") return "No details";
			if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
			return typeof value === "string" ? value : JSON.stringify(value, null, 2);
		}

		function Slot({ title, slot }) {
			if (!slot) return null;
			const bad = ["failed", "blocked"].includes(slot.status);
			const unavailable = slot.status === "unavailable";
			return h("section", { className: "s2p2p-card" },
				h("h3", null, title, " · ", slot.status || "idle"),
				h("div", { className: "s2p2p-body" },
					h("div", { className: "s2p2p-status " + (bad ? "bad" : unavailable ? "warn" : "") }, slot.diagnostic?.message || valueText(slot.value)),
				),
			);
		}

		function Row({ row, run, disabled }) {
			const control = row.control;
			const editDisabled = disabled || row.editable === false || !control;
			const meta = [row.provenance, row.default === undefined ? null : `default: ${valueText(row.default)}`, row.metadata].filter(Boolean).join(" · ");
			let editor = null;
			if (control?.type === "toggle") {
				editor = h("input", { type: "checkbox", checked: row.enabled === true, disabled: editDisabled, "data-row-id": row.id, onChange: (event) => run({ type: "draft.toggle", rowId: row.id, enabled: event.target.checked }) });
			} else if (control?.type === "select") {
				editor = h("select", { className: "s2p2p-input", value: row.value ?? "", disabled: editDisabled, "data-row-id": row.id, onChange: (event) => run({ type: "draft.edit", rowId: row.id, value: event.target.value }) },
					(control.options || []).map((option) => h("option", { key: String(option.value), value: option.value }, option.title || String(option.value))),
				);
			} else if (control) {
				editor = h("input", { className: "s2p2p-input", type: control.type === "number" ? "number" : "text", defaultValue: row.value ?? "", disabled: editDisabled, "data-row-id": row.id, onBlur: (event) => {
					const value = control.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value;
					if (!Object.is(value, row.value)) run({ type: "draft.edit", rowId: row.id, value });
				} });
			}
			return h("div", { className: "s2p2p-item" },
				h("div", { className: "s2p2p-row" }, h("strong", null, row.title || row.id), h("span", { className: "s2p2p-meta" }, row.enabled === false ? "disabled" : "enabled")),
				row.description ? h("div", { className: "s2p2p-sub" }, row.description) : null,
				meta ? h("div", { className: "s2p2p-meta" }, meta) : null,
				editor,
			);
		}

		function PresetTab({ visible, scope, transport, pollMs }) {
			const [snapshot, setSnapshot] = React.useState(null);
			const [busy, setBusy] = React.useState(null);
			const [error, setError] = React.useState(null);

			const load = React.useCallback(async () => {
				try {
					const next = await transport.command({ type: "panel.snapshot" }, scope);
					setSnapshot(next);
					setError(null);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, [transport, scope.sessionId, scope.cwd]);

			React.useEffect(() => {
				if (!visible) return undefined;
				let active = true;
				const refresh = async () => { if (active) await load(); };
				void refresh();
				const timer = setInterval(refresh, pollMs);
				return () => { active = false; clearInterval(timer); };
			}, [visible, load, pollMs]);

			const run = async (command) => {
				setBusy(command.type);
				setError(null);
				try {
					const next = await transport.command(command, scope);
					if (next && typeof next === "object") setSnapshot(next);
					await load();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally { setBusy(null); }
			};

			if (!snapshot) return h("div", { className: "s2p2p-root" }, h("div", { className: "s2p2p-empty" }, error || "Loading Preset authoring state…"));
			const target = snapshot.target;
			const readOnly = target?.editable !== true;
			const categories = snapshot.inspection?.categories || [];
			const history = Array.isArray(snapshot.history?.value) ? snapshot.history.value : [];
			return h("div", { className: "s2p2p-root", "data-preset-authoring": "" },
				h("header", { className: "s2p2p-head" }, h("div", null, h("div", { className: "s2p2p-title" }, "Preset"), h("div", { className: "s2p2p-sub" }, "Shared Host-owned draft")), busy ? h("span", { className: "s2p2p-meta" }, busy, "…") : null),
				h("div", { className: "s2p2p-status" }, "Session preset ", h("strong", null, snapshot.sessionPresetId || "unknown"), h("div", { className: "s2p2p-sub" }, "The running session stays on this preset.")),
				h("label", { className: "s2p2p-label", htmlFor: "s2p2p-target" }, "Target preset"),
				h("select", { id: "s2p2p-target", className: "s2p2p-select", value: target?.id || "", disabled: !!busy, onChange: (event) => run({ type: "target.open", targetId: event.target.value }) },
				(snapshot.targets || []).map((item) => h("option", { key: item.id, value: item.id }, item.title || item.id, item.editable === true ? "" : " · read-only")),
			),
			readOnly && target ? h("div", { className: "s2p2p-banner" }, h("div", null, target.id, " is read-only. System targets cannot be edited in place."), h("button", { className: "s2p2p-btn", disabled: !!busy, onClick: () => {
				const suggested = `${target.id}-copy`;
				const targetId = typeof window.prompt === "function" ? window.prompt("Editable preset id", suggested) : suggested;
				if (targetId) run({ type: "target.copy", sourceId: target.id, targetId });
			} }, "Copy to editable")) : null,
			snapshot.stale ? h("div", { className: "s2p2p-banner" }, "Stale Preset Draft — the saved target changed. Reopen or reconcile before Apply.") : null,
			error ? h("div", { className: "s2p2p-status bad" }, error) : null,
			categories.map((category) => h("details", { className: "s2p2p-card", key: category.id, open: category.id === "prompt" },
				h("summary", null, category.title || category.id),
				h("div", { className: "s2p2p-body" }, (category.rows || []).length ? category.rows.map((row) => h(Row, { key: row.id, row, run, disabled: !!busy || readOnly })) : h("div", { className: "s2p2p-meta" }, "No configured entries")),
			)),
			h("div", { className: "s2p2p-actions" },
				h("button", { className: "s2p2p-btn", disabled: !!busy || !target, onClick: () => run({ type: "draft.refreshAnalysis" }) }, "Refresh checks & diff"),
				h("button", { className: "s2p2p-btn", disabled: !!busy || !target, onClick: () => run({ type: "draft.validateMount" }) }, "Validate mount"),
				h("button", { className: "s2p2p-btn primary", disabled: !!busy || readOnly || snapshot.stale, onClick: () => run({ type: "draft.apply" }) }, "Apply"),
			),
			h(Slot, { title: "Preflight", slot: snapshot.preflight }),
			h(Slot, { title: "Mount", slot: snapshot.mount }),
			h(Slot, { title: "Semantic diff", slot: snapshot.semanticDiff }),
			h("details", { className: "s2p2p-card" }, h("summary", null, "Raw diff · ", snapshot.rawDiff?.status || "idle"), h("div", { className: "s2p2p-body s2p2p-diff" }, snapshot.rawDiff?.diagnostic?.message || valueText(snapshot.rawDiff?.value))),
			h("section", { className: "s2p2p-card" }, h("h3", null, "History · ", snapshot.history?.status || "idle"), h("div", { className: "s2p2p-body" },
				h("button", { className: "s2p2p-btn", disabled: !!busy || !target, onClick: () => run({ type: "history.load" }) }, "Refresh history"),
				history.map((entry) => h("div", { className: "s2p2p-item s2p2p-row", key: entry.revision }, h("span", null, entry.title || entry.revision, h("span", { className: "s2p2p-meta" }, " · ", entry.revision)), h("button", { className: "s2p2p-btn", disabled: !!busy || readOnly, onClick: () => run({ type: "history.restore", revision: entry.revision }) }, "Restore"))),
			)),
			h("section", { className: "s2p2p-card" }, h("h3", null, "Fresh-session test · ", snapshot.test?.status || "idle"), h("div", { className: "s2p2p-body" },
				h("div", { className: "s2p2p-sub" }, "Starts a separate session with the saved target. It never changes this running session preset; use dsh-context there for runtime truth."),
				snapshot.test?.diagnostic?.message ? h("div", { className: "s2p2p-status bad" }, snapshot.test.diagnostic.message) : null,
				snapshot.test?.value ? h("div", { className: "s2p2p-status" }, valueText(snapshot.test.value)) : null,
				h("button", { className: "s2p2p-btn", disabled: !!busy || !target || snapshot.apply?.status !== "ready", onClick: () => run({ type: "test.start", targetId: target.id }) }, "Test in fresh session"),
			)),
		);
		}

		function descriptorFor(transport, pollMs) {
			function BoundPresetTab(props) {
				return PresetTab({ ...props, transport, pollMs });
			}
			return Object.freeze({
				id: TAB_ID,
				title: "Preset",
				order: 55,
				single: true,
				icon: (size) => h("span", { style: { fontSize: `${Math.max(12, size - 2)}px` }, "aria-hidden": "true" }, "◇"),
				component: BoundPresetTab,
			});
		}

		exports.inject = [];
		exports.createTransport = createTransport;
		exports.getIntegrationStatus = () => integrationStatus;
		exports.apply = (ctx, config = {}) => {
			const transport = config.transport || createTransport();
			const descriptor = descriptorFor(transport, config.pollMs || SNAPSHOT_POLL_MS);
			ctx.effect(() => {
				let service = null;
				let unregister;
				let warned = false;
				const sync = () => {
					const next = ctx.get("betterSidebar");
					if (next === service) return;
					unregister?.();
					unregister = undefined;
					service = next;
					if (next && typeof next.registerTab === "function") {
						unregister = next.registerTab(descriptor);
						integrationStatus = Object.freeze({ state: "registered", message: "Preset tab registered with Better Sidebar" });
					} else {
						integrationStatus = Object.freeze({ state: "missing-sidebar", message: "Better Sidebar 0.18 is required to show the Preset panel" });
						if (!warned) {
							warned = true;
							console.warn("[dsh-preset-authoring] Better Sidebar 0.18 is required to show the Preset panel; Host preset services remain available.");
						}
					}
				};
				sync();
				const timer = setInterval(sync, config.sidebarReconcileMs || SIDEBAR_RECONCILE_MS);
				return () => {
					clearInterval(timer);
					unregister?.();
					unregister = undefined;
					service = undefined;
					integrationStatus = Object.freeze({ state: "disposed", message: "Preset tab registration disposed" });
				};
			});
		};
		return module.exports;
	},
});
