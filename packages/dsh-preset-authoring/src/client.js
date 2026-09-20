/**
 * Browser half: one profile-wide Preset tab contributed through Better
 * Sidebar's public client service. This hand-authored lazy-CJS bundle keeps
 * dsh-better-sidebar entirely optional: there are no type or runtime imports.
 * It is one replaceable consumer of the presentation boundary and only ever
 * renders the view-model served by the Host panel route.
 *
 * The tab renders the adapted Preset Studio (roster with trust badges,
 * composition viewer, generic Cordis row editor with per-row YAML config, raw
 * YAML view). Surfaces are adapted from DeepSeek App (MIT):
 * https://github.com/RongleCat/deepseek-app
 * pinned commit e1be3e82119b85110b58f10c808076ecc7b422f4
 * `src/renderer/components/settings/PresetStudio.tsx` — the editor-tree patch
 * helpers, display classifier, moduleShortName, and the in-panel CopyForm
 * (source select, required new id, optional name) below are ported from it.
 * The browser keeps no second Preset Draft: every committed change goes
 * through the Host (`draft.putRows` serializes Host-side), and the local row
 * tree is ephemeral form state that is CAS-guarded on save.
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
		const INVENTORY_LIST_ID = "s2p2p-inventory-names";
		const KIND_GROUPS = [
			["tool", "Tools"],
			["prompt", "Prompt"],
			["delegation", "Delegation"],
			["group", "Groups"],
			["other", "Other"],
		];
		let integrationStatus = Object.freeze({ state: "initializing", message: "Looking for Better Sidebar" });

		const CSS = `
.s2p2p-root,.s2p2p-root *{box-sizing:border-box}.s2p2p-root{height:100%;overflow:auto;padding:12px;color:var(--dsw-alias-label-primary,#e6e9ef);font:13px/1.45 var(--dsw-font-family,sans-serif)}
.s2p2p-head,.s2p2p-row,.s2p2p-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.s2p2p-head{justify-content:space-between;margin-bottom:10px}.s2p2p-title{font-size:16px;font-weight:650}.s2p2p-sub,.s2p2p-meta{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:11px}.s2p2p-label{font-size:11px;color:var(--dsw-alias-label-secondary,#aab2c0);display:block;margin:9px 0 4px}.s2p2p-select,.s2p2p-input{width:100%;min-width:0;background:var(--dsw-alias-bg-base,#101319);color:inherit;border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:7px;padding:6px 8px}.s2p2p-btn{border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:7px;background:var(--dsw-alias-bg-base,#101319);color:inherit;padding:5px 9px;cursor:pointer}.s2p2p-btn:disabled{opacity:.5;cursor:default}.s2p2p-btn.primary{background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff;border-color:transparent}.s2p2p-card{border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:9px;margin:10px 0;background:var(--dsw-alias-bg-layer-1,#161a22);overflow:hidden}.s2p2p-card>summary,.s2p2p-card>h3{padding:8px 10px;margin:0;font-size:12px;font-weight:650}.s2p2p-body{padding:0 10px 10px}.s2p2p-item{padding:8px 0;border-top:1px solid var(--dsw-alias-border-l2,#242936)}.s2p2p-item:first-child{border-top:0}.s2p2p-row{justify-content:space-between}.s2p2p-status{padding:7px 9px;border-radius:7px;background:var(--dsw-alias-bg-base,#101319);white-space:pre-wrap}.s2p2p-status.bad{color:var(--dsw-alias-state-error-primary,#f87171)}.s2p2p-status.warn{color:var(--dsw-alias-state-warn-primary,#fbbf24)}.s2p2p-diff,.s2p2p-pre{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.s2p2p-pre{margin:0;padding:7px 9px;border-radius:7px;background:var(--dsw-alias-bg-base,#101319)}.s2p2p-banner{padding:8px;border:1px solid var(--dsw-alias-state-warn-primary,#fbbf24);border-radius:8px;color:var(--dsw-alias-state-warn-primary,#fbbf24);margin:8px 0}.s2p2p-banner .s2p2p-btn{margin-top:6px}.s2p2p-copy{padding:2px 0 4px}.s2p2p-empty{padding:20px 8px;text-align:center;color:var(--dsw-alias-label-tertiary,#8b949e)}
.s2p2p-tabs{display:flex;gap:6px;margin:10px 0;flex-wrap:wrap}.s2p2p-chip{border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:99px;background:var(--dsw-alias-bg-base,#101319);color:inherit;font-size:12px;padding:4px 11px;cursor:pointer}.s2p2p-chip.on{background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff;border-color:transparent}.s2p2p-badge{font-size:10px;line-height:1;padding:3px 7px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2,#242936);color:var(--dsw-alias-label-secondary,#aab2c0)}.s2p2p-badge.system{color:var(--dsw-alias-state-business-primary,#60a5fa)}.s2p2p-badge.user{color:var(--dsw-alias-state-warn-primary,#fbbf24)}.s2p2p-kind{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none;background:var(--dsw-alias-label-tertiary,#8b949e)}.s2p2p-kind--tool{background:var(--dsw-alias-state-business-primary,#3b82f6)}.s2p2p-kind--prompt{background:var(--dsw-alias-state-success-primary,#4ade80)}.s2p2p-kind--delegation{background:var(--dsw-alias-state-warn-primary,#fbbf24)}.s2p2p-kind--group{background:var(--dsw-alias-label-secondary,#aab2c0)}.s2p2p-kind--other{background:var(--dsw-alias-label-tertiary,#8b949e)}.s2p2p-crow{display:flex;align-items:center;gap:8px;padding:4px 0}.s2p2p-crow code{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.s2p2p-editor-row{border:1px solid var(--dsw-alias-border-l2,#242936);border-radius:8px;margin:8px 0;padding:8px;background:var(--dsw-alias-bg-base,#101319)}.s2p2p-editor-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.s2p2p-editor-head .s2p2p-input{width:auto;flex:1 1 120px;min-width:0}.s2p2p-editor-id{flex:0 1 110px !important}.s2p2p-editor-children{margin:8px 0 0 20px}.s2p2p-textarea{width:100%;min-height:70px;background:var(--dsw-alias-bg-base,#101319);color:inherit;border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:7px;padding:6px 8px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.s2p2p-check{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary,#aab2c0)}.s2p2p-hint{font-size:12px;margin:6px 0}.s2p2p-hint.ok{color:var(--dsw-alias-state-success-primary,#4ade80)}.s2p2p-hint.err{color:var(--dsw-alias-state-error-primary,#f87171)}
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
						const recoveryNote = diagnostic.recoveryState === "unrecovered" ? " (fatal: candidate may still be persisted)" : diagnostic.recoveryState === "recovered-via-fallback" ? " (recovered via captured-source fallback)" : "";
						const error = Object.assign(new Error((diagnostic.message || `Preset authoring request failed (${response.status})`) + recoveryNote), diagnostic.code ? { code: diagnostic.code } : {}, { diagnostic });
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

		// ── upstream Preset Studio helpers (MIT, RongleCat/deepseek-app @ e1be3e8) ──
		// The full parser/serializer lives Host-side (preset-yaml.js); only these
		// small, display-only pieces are inlined because this bundle cannot
		// import modules.

		function mutateEditor(rows, key, patch) {
			return rows.map((r) => {
				if (r.key === key) return { ...r, ...patch };
				if (r.children && r.children.length) return { ...r, children: mutateEditor(r.children, key, patch) };
				return r;
			});
		}

		function removeEditorRow(rows, key) {
			return rows.filter((r) => r.key !== key).map((r) => (r.children && r.children.length ? { ...r, children: removeEditorRow(r.children, key) } : r));
		}

		function categorizeRow(name, group = false) {
			if (group || name === "cordis:group") return "group";
			if (name.includes("dsh-persona") || name.includes("dsh-agent-instructions") || name.includes("dsh-plan-mode") || name.includes("dsh-compaction") || name.includes("dsh-tool-result-pruner") || name.includes("dsh-command-compact")) return "prompt";
			if (name.includes("subagent") || name.includes("workflow") || name.includes("ralph")) return "delegation";
			if (name.includes("-tool-") || name.includes("dsh-tool") || name.includes("dsh-agent-tool") || name.includes("dsh-terminal")) return "tool";
			return "other";
		}

		function moduleShortName(moduleName) {
			return (moduleName.startsWith("@") ? moduleName.slice(moduleName.indexOf("/") + 1) : moduleName)
				.replace(/^cordis:/, "")
				.replace(/^cordis-plugin-/, "")
				.replace(/^dsh-(?:host-|client-)?/, "");
		}

		function newEditorRow(key) {
			return { key, id: "", name: "", disabled: false, group: false, isolate: {}, configText: "", children: [] };
		}

		// Advisory pre-save row validation. This is a minimal inlined mirror of
		// the Host-side checks `rowsFromEditor` runs (preset-editor-model.js +
		// preset-yaml.js, both MIT-adapted from upstream; see UPSTREAM.md): a
		// row without a package name and a non-empty config with unbalanced
		// flow collections can never serialize. It only reports definite
		// errors so it can never disagree with the authoritative Host check —
		// the server-side PRESET_ROW_NEEDS_PACKAGE / PRESET_BAD_ROW_CONFIG
		// rejection remains the final word.
		function balancedFlowCollections(text) {
			const stack = [];
			let quote = null;
			for (let i = 0; i < text.length; i += 1) {
				const c = text[i];
				if (quote) {
					if (c === quote) quote = null;
					continue;
				}
				if (c === "'" || c === '"') {
					quote = c;
					continue;
				}
				if (c === "[" || c === "{") stack.push(c);
				else if (c === "]") { if (stack.pop() !== "[") return false; }
				else if (c === "}") { if (stack.pop() !== "{") return false; }
			}
			return stack.length === 0;
		}

		function rowIssues(rows, out = new Map()) {
			for (const row of rows) {
				if (!String(row.name || "").trim()) out.set(row.key, "needPackage");
				else if (!row.group && String(row.configText || "").trim() !== "" && !balancedFlowCollections(row.configText)) out.set(row.key, "badConfig");
				if (row.group) rowIssues(row.children || [], out);
			}
			return out;
		}

		function issueText(issue) {
			return issue === "needPackage"
				? "This row needs a package name before it can be saved."
				: "This config cannot be saved: an unbalanced [ or { can never serialize back faithfully.";
		}

		function inventoryNamesOf(inventory) {
			const set = new Set((inventory?.entries || []).map((entry) => entry.moduleName).filter(Boolean));
			set.add("cordis:group");
			return [...set].sort();
		}

		function Slot({ title, slot }) {
			if (!slot) return null;
			const bad = ["failed", "blocked"].includes(slot.status);
			const unavailable = slot.status === "unavailable";
			const recovery = slot.diagnostic?.recoveryState || slot.value?.recoveryState;
			const recoveryText = recovery === "unrecovered" ? "UNRECOVERED — candidate may still be persisted" : recovery === "recovered-via-fallback" ? "Recovered via captured-source fallback" : null;
			return h("section", { className: "s2p2p-card" },
				h("h3", null, title, " · ", slot.status || "idle"),
				h("div", { className: "s2p2p-body" },
					h("div", { className: "s2p2p-status " + (bad ? "bad" : unavailable ? "warn" : "") }, slot.diagnostic?.message || valueText(slot.value)),
					recoveryText ? h("div", { className: "s2p2p-status " + (recovery === "unrecovered" ? "bad" : "warn") }, recoveryText) : null,
				),
			);
		}

		function TrustBadge({ trust }) {
			if (trust !== "system" && trust !== "user") return null;
			return h("span", { className: "s2p2p-badge " + trust }, trust === "system" ? "system" : "user");
		}

		function CompositionView({ rows }) {
			if (!rows || rows.length === 0) return h("div", { className: "s2p2p-empty" }, "No composition rows");
			return h("div", null, KIND_GROUPS
				.map(([kind, label]) => [kind, label, rows.filter((row) => row.kind === kind)])
				.filter(([, , items]) => items.length > 0)
				.map(([kind, label, items]) => h("details", { key: kind, className: "s2p2p-card", open: kind !== "other" },
					h("summary", null, label, " · ", items.length),
					h("div", { className: "s2p2p-body" }, items.map((row, index) => h("div", { key: index, className: "s2p2p-crow", style: { paddingLeft: `${row.depth * 16}px` } },
						h("span", { className: "s2p2p-kind s2p2p-kind--" + row.kind, "aria-hidden": "true" }),
						h("span", { className: "s2p2p-meta" }, row.id || "·"),
						h("code", { title: row.name }, row.name),
						row.disabled === true ? h("span", { className: "s2p2p-meta" }, "disabled") : null,
						row.disabled === "conditional" ? h("span", { className: "s2p2p-meta" }, "conditional") : null,
					))),
				)));
		}

		function EditorRowView({ row, disabled, issues, onPatch, onRemove }) {
			const issue = issues.get(row.key);
			return h("div", { className: "s2p2p-editor-row", "data-row-key": row.key },
				h("div", { className: "s2p2p-editor-head" },
					h("span", { className: "s2p2p-kind s2p2p-kind--" + categorizeRow(row.name, row.group), "aria-hidden": "true" }),
					h("input", { className: "s2p2p-input s2p2p-editor-id", value: row.id, placeholder: "row id", spellCheck: false, disabled, "aria-label": "Row id", onChange: (event) => onPatch({ id: event.target.value }) }),
					h("input", { className: "s2p2p-input", list: INVENTORY_LIST_ID, value: row.name, placeholder: "package name", spellCheck: false, disabled, "aria-invalid": issue === "needPackage" || undefined, "aria-label": "Package name", onChange: (event) => onPatch({ name: event.target.value }) }),
					row.name ? h("span", { className: "s2p2p-meta" }, moduleShortName(row.name)) : null,
					h("label", { className: "s2p2p-check", title: "Disabled rows stay in the composition but do not load" },
						h("input", { type: "checkbox", checked: row.disabled === true, disabled, onChange: (event) => onPatch({ disabled: event.target.checked }) }),
						"disabled"),
					h("button", { type: "button", className: "s2p2p-btn", disabled, "aria-label": "Remove row", onClick: onRemove }, "×"),
				),
				row.group
					? h("div", { className: "s2p2p-editor-children" },
						(row.children || []).map((child) => h(EditorRowView, {
							key: child.key,
							row: child,
							disabled,
							issues,
							onPatch: (patch) => onPatch({ children: mutateEditor(row.children, child.key, patch) }),
							onRemove: () => onPatch({ children: removeEditorRow(row.children, child.key) }),
						})),
						h("button", { type: "button", className: "s2p2p-btn", disabled, onClick: () => onPatch({ children: [...(row.children || []), newEditorRow(`${row.key}.new-${Date.now()}`)] }) }, "+ Add nested row"),
					)
					: h("div", null,
						h("span", { className: "s2p2p-label" }, "config (YAML)"),
						h("textarea", { className: "s2p2p-textarea", value: row.configText, spellCheck: false, rows: 4, disabled, "aria-invalid": issue === "badConfig" || undefined, placeholder: "key: value", "aria-label": "Row config YAML", onChange: (event) => onPatch({ configText: event.target.value }) }),
					),
				issue ? h("div", { className: "s2p2p-status bad", role: "alert" }, issueText(issue)) : null,
			);
		}

		function RowEditor({ editor, inventoryNames, disabled, diverged, onPatch, onRemove, onSave, onReload, onAddRow }) {
			const issues = disabled ? new Map() : rowIssues(editor);
			return h("div", null,
				h("datalist", { id: INVENTORY_LIST_ID }, inventoryNames.map((name) => h("option", { key: name, value: name }))),
				inventoryNames.length > 1
					? h("div", { className: "s2p2p-meta" }, "Package names autocomplete from the installed plugin inventory (", inventoryNames.length, " entries incl. cordis:group); unknown names stay freely editable.")
					: h("div", { className: "s2p2p-meta" }, "Plugin inventory unavailable — package names are free text."),
				diverged ? h("div", { className: "s2p2p-banner" },
					"The shared draft changed after these rows were loaded (another surface or Apply/restore). Saving is conflict-checked; reload rows to adopt the current draft.",
					h("button", { type: "button", className: "s2p2p-btn", onClick: onReload }, "Reload rows"),
				) : null,
				editor.length === 0 ? h("div", { className: "s2p2p-empty" }, "No composition rows") : null,
				editor.map((row) => h(EditorRowView, { key: row.key, row, disabled, issues, onPatch: (patch) => onPatch(row.key, patch), onRemove: () => onRemove(row.key) })),
				h("div", { className: "s2p2p-actions" },
					h("button", { type: "button", className: "s2p2p-btn", disabled, onClick: onAddRow }, "+ Add row"),
					h("button", { type: "button", className: "s2p2p-btn primary", disabled: disabled || issues.size > 0, title: issues.size > 0 ? "Fix the flagged rows first" : undefined, onClick: onSave }, "Save rows to draft"),
				),
				issues.size > 0 ? h("div", { className: "s2p2p-status warn" }, issues.size, " row", issues.size === 1 ? "" : "s", " cannot be saved yet. Validation is advisory here; the Host repeats it authoritatively on save.") : null,
			);
		}

		function RawYamlView({ composition }) {
			return h("div", null,
				h("div", { className: "s2p2p-meta" }, "Fidelity: saving rows re-serializes agent.cordis.yml — comments are dropped and key order is normalized. Opening or inspecting a preset never rewrites it; the saved file changes only on Apply, and Raw diff previews the exact result."),
				composition.draft === undefined
					? h("div", { className: "s2p2p-empty" }, composition.present ? "The draft composition is not UTF-8 text." : "No agent.cordis.yml in this preset yet.")
					: h("details", { className: "s2p2p-card", open: true }, h("summary", null, "Draft · ", composition.path), h("div", { className: "s2p2p-body" }, h("pre", { className: "s2p2p-pre" }, composition.draft))),
				composition.source === undefined ? null : h("details", { className: "s2p2p-card" }, h("summary", null, "Saved source · ", composition.path), h("div", { className: "s2p2p-body" }, h("pre", { className: "s2p2p-pre" }, composition.source))),
			);
		}

		function seedEditor(snapshot) {
			const composition = snapshot?.composition;
			return {
				targetId: snapshot?.target?.id ?? null,
				draftFingerprint: snapshot?.draftFingerprint ?? null,
				rows: (composition?.editor || []).map((row) => ({ ...row, children: [...(row.children || [])] })),
			};
		}

		// In-panel copy-first form (upstream CopyForm, PresetStudio.tsx:257-315
		// pattern): source preset select, required new id, optional display
		// name. It never writes presets itself — the Host's `target.copy`
		// command performs DSH's native copy and opens the editable result.
		function CopyForm({ targets, sourceId, id, name, hint, busy, onField, onSubmit }) {
			return h("div", { className: "s2p2p-copy", "data-copy-form": "" },
				h("label", { className: "s2p2p-label", htmlFor: "s2p2p-copy-source" }, "Copy from"),
				h("select", { id: "s2p2p-copy-source", className: "s2p2p-select", value: sourceId, disabled: !!busy, "aria-label": "Copy source", onChange: (event) => onField({ sourceId: event.target.value }) },
					targets.map((item) => h("option", { key: item.id, value: item.id }, item.title || item.id)),
				),
				h("label", { className: "s2p2p-label", htmlFor: "s2p2p-copy-id" }, "New preset id (required)"),
				h("input", { id: "s2p2p-copy-id", className: "s2p2p-input", value: id, placeholder: "my-preset", spellCheck: false, disabled: !!busy, "aria-label": "New preset id", onChange: (event) => onField({ id: event.target.value }) }),
				h("label", { className: "s2p2p-label", htmlFor: "s2p2p-copy-name" }, "Display name (optional)"),
				h("input", { id: "s2p2p-copy-name", className: "s2p2p-input", value: name, spellCheck: false, disabled: !!busy, "aria-label": "New preset name", onChange: (event) => onField({ name: event.target.value }) }),
				hint?.text ? h("div", { className: "s2p2p-status " + (hint.tone === "err" ? "bad" : "ok"), role: "alert" }, hint.text) : null,
				h("div", { className: "s2p2p-actions" },
					h("button", { type: "button", className: "s2p2p-btn primary", disabled: !!busy, onClick: onSubmit }, busy === "target.copy" ? "Copying…" : "Copy to editable"),
				),
			);
		}

		function PresetTab({ visible, scope, transport, pollMs }) {
			const [snapshot, setSnapshot] = React.useState(null);
			const [busy, setBusy] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [inventory, setInventory] = React.useState(null);
			const [editorState, setEditorState] = React.useState(null);
			const [mode, setMode] = React.useState("composition");
			const [hint, setHint] = React.useState(null);
			const [copy, setCopy] = React.useState({ sourceId: "", id: "", name: "" });
			const [copyHint, setCopyHint] = React.useState(null);

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

			React.useEffect(() => {
				if (!visible) return undefined;
				let active = true;
				transport.command({ type: "inventory.list" }, scope)
					.then((value) => { if (active) setInventory(value); })
					.catch(() => { if (active) setInventory({ entries: [] }); });
				return () => { active = false; };
			}, [visible, transport, scope.sessionId]);

			React.useEffect(() => {
				// Seed the local row editor only when the Target Preset changes;
				// polls never clobber in-progress edits (divergence shows a banner).
				if (!snapshot) return;
				setEditorState(seedEditor(snapshot));
			}, [snapshot?.target?.id]);

			const run = async (command) => {
				setBusy(command.type);
				setError(null);
				try {
					const guardedTypes = ["draft.edit", "draft.toggle", "draft.putRows", "draft.refreshAnalysis", "draft.validateMount", "draft.apply", "history.load", "history.restore"];
					const outgoing = guardedTypes.includes(command.type) ? {
						...command,
						targetId: snapshot.target?.id,
						expectedRevision: snapshot.revision,
						expectedSourceFingerprint: snapshot.sourceFingerprint,
						expectedDraftFingerprint: snapshot.draftFingerprint,
					} : command;
					const next = await transport.command(outgoing, scope);
					if (next && typeof next === "object") setSnapshot(next);
					await load();
					return next;
				} catch (cause) {
					// Refresh even on failure: the Host state often advanced
					// (a blocked Apply marks the draft stale) and the banner
					// for it lives in the authoritative snapshot.
					await load();
					setError(cause instanceof Error ? cause.message : String(cause));
					return null;
				} finally { setBusy(null); }
			};

			const saveRows = async () => {
				if (!editorState || !snapshot?.target) return;
				setBusy("draft.putRows");
				setError(null);
				setHint(null);
				try {
					const next = await transport.command({
						type: "draft.putRows",
						rows: editorState.rows,
						targetId: snapshot.target?.id,
						expectedRevision: snapshot.revision,
						expectedSourceFingerprint: snapshot.sourceFingerprint,
						expectedDraftFingerprint: snapshot.draftFingerprint,
					}, scope);
					if (next && typeof next === "object") {
						setSnapshot(next);
						setEditorState(seedEditor(next));
					}
					await load();
					setHint({ tone: "ok", text: "Rows saved to the shared draft. Apply writes the saved preset." });
				} catch (cause) {
					const conflict = cause?.code === "PRESET_DRAFT_CONFLICT";
					// A conflicted save means the shared draft moved on elsewhere
					// (another surface, Apply, or restore). Refresh so the
					// divergence banner appears immediately; the local rows stay
					// intact for a reload-and-retry against the fresh CAS fields.
					if (conflict) await load();
					setError(cause instanceof Error ? cause.message : String(cause));
					setHint({ tone: "err", text: conflict
						? "The shared draft changed while these rows were open. Use Reload rows to adopt the current draft, then save again."
						: cause?.code === "PRESET_BAD_ROW_CONFIG" ? "A row config is not valid YAML for this editor — fix it before saving."
						: cause?.code === "PRESET_ROW_NEEDS_PACKAGE" ? "Every composition row needs a package name."
						: null });
				} finally { setBusy(null); }
			};

			const submitCopy = async () => {
				if (!snapshot) return;
				const targets = snapshot.targets || [];
				const sourceId = copy.sourceId || snapshot.target?.id || targets[0]?.id || "";
				const targetId = copy.id.trim();
				if (!targetId) {
					setCopyHint({ tone: "err", text: "A new preset id is required." });
					return;
				}
				setBusy("target.copy");
				setError(null);
				setCopyHint(null);
				try {
					const name = copy.name.trim();
					const next = await transport.command({ type: "target.copy", sourceId, targetId, ...(name ? { name } : {}) }, scope);
					if (next && typeof next === "object") {
						setSnapshot(next);
						setEditorState(seedEditor(next));
					}
					await load();
					setCopy({ sourceId: "", id: "", name: "" });
					// The form closes once the editable copy becomes the target,
					// so the confirmation renders at panel level.
					setHint({ tone: "ok", text: `Copied to ${targetId}. The editable copy is now the target.` });
				} catch (cause) {
					// Upstream CopyForm behavior: keep the entered values and
					// surface the Host diagnostic inline; nothing was written.
					setCopyHint({ tone: "err", text: cause instanceof Error ? cause.message : String(cause) });
				} finally { setBusy(null); }
			};

			if (!snapshot) return h("div", { className: "s2p2p-root" }, h("div", { className: "s2p2p-empty" }, error || "Loading Preset authoring state…"));
			const target = snapshot.target;
			const readOnly = target?.editable !== true;
			const composition = snapshot.composition || { path: "agent.cordis.yml", present: false };
			const inventoryNames = inventoryNamesOf(inventory);
			const editor = editorState?.rows ?? [];
			const diverged = editorState !== null && snapshot.draftFingerprint !== editorState.draftFingerprint;
			const history = Array.isArray(snapshot.history?.value) ? snapshot.history.value : [];
			return h("div", { className: "s2p2p-root", "data-preset-authoring": "" },
				h("header", { className: "s2p2p-head" }, h("div", null, h("div", { className: "s2p2p-title" }, "Preset"), h("div", { className: "s2p2p-sub" }, "Shared Host-owned draft")), busy ? h("span", { className: "s2p2p-meta" }, busy, "…") : null),
				h("div", { className: "s2p2p-status" }, "Session preset ", h("strong", null, snapshot.sessionPresetId || "unknown"), h("div", { className: "s2p2p-sub" }, "The running session stays on this preset.")),
				h("label", { className: "s2p2p-label", htmlFor: "s2p2p-target" }, "Target preset"),
				h("select", { id: "s2p2p-target", className: "s2p2p-select", value: target?.id || "", disabled: !!busy, onChange: (event) => run({ type: "target.open", targetId: event.target.value }) },
					h("option", { value: "", disabled: true }, "Select a target…"),
					(snapshot.targets || []).map((item) => h("option", { key: item.id, value: item.id }, item.title || item.id, item.editable === true ? "" : " · read-only", item.trust ? ` · ${item.trust}` : "")),
				),
				target ? h("div", { className: "s2p2p-row", style: { margin: "6px 0" } },
					h("strong", null, target.title || target.id),
					h(TrustBadge, { trust: target.trust }),
					h("span", { className: "s2p2p-badge" }, readOnly ? "read-only" : "editable"),
					target.broken ? h("span", { className: "s2p2p-badge" }, "broken") : null,
					target.description ? h("span", { className: "s2p2p-meta" }, target.description) : null,
				) : null,
				readOnly && target ? h("div", { className: "s2p2p-banner" },
					h("div", null, target.id, " is read-only. System and shipped targets cannot be edited in place — copy one into the editable preset root to start from it."),
					h(CopyForm, {
						targets: snapshot.targets || [],
						sourceId: copy.sourceId || target.id,
						id: copy.id,
						name: copy.name,
						hint: copyHint,
						busy,
						onField: (patch) => { setCopy((previous) => ({ ...previous, ...patch })); setCopyHint(null); },
						onSubmit: submitCopy,
					}),
				) : null,
				snapshot.stale ? h("div", { className: "s2p2p-banner" },
					h("div", null, "Stale Preset Draft — the saved target changed on disk after this draft opened. Reopen adopts the saved target as a fresh draft; Apply stays blocked until then."),
					h("button", { type: "button", className: "s2p2p-btn", disabled: !!busy || !target, onClick: () => run({ type: "target.open", targetId: target.id }) }, "Reopen target"),
				) : null,
				error ? h("div", { className: "s2p2p-status bad" }, error) : null,
				hint?.text ? h("div", { className: "s2p2p-hint " + (hint.tone === "ok" ? "ok" : "err") }, hint.text) : null,
				h("div", { className: "s2p2p-tabs" },
					h("button", { type: "button", className: "s2p2p-chip" + (mode === "composition" ? " on" : ""), onClick: () => setMode("composition") }, "Composition"),
					h("button", { type: "button", className: "s2p2p-chip" + (mode === "editor" ? " on" : ""), onClick: () => setMode("editor") }, "Row editor"),
					h("button", { type: "button", className: "s2p2p-chip" + (mode === "raw" ? " on" : ""), onClick: () => setMode("raw") }, "Raw YAML"),
				),
				mode === "composition" ? h(CompositionView, { rows: composition.rows })
					: mode === "editor" ? h(RowEditor, {
						editor,
						inventoryNames,
						disabled: !!busy || readOnly || !target,
						diverged,
						onPatch: (key, patch) => setEditorState((previous) => previous && { ...previous, rows: mutateEditor(previous.rows, key, patch) }),
						onRemove: (key) => setEditorState((previous) => previous && { ...previous, rows: removeEditorRow(previous.rows, key) }),
						onSave: saveRows,
						onReload: () => setEditorState(seedEditor(snapshot)),
						onAddRow: () => setEditorState((previous) => previous && { ...previous, rows: [...previous.rows, newEditorRow(`new-${Date.now()}`)] }),
					})
					: h(RawYamlView, { composition }),
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
					history.map((entry) => h("div", { className: "s2p2p-item s2p2p-row", key: entry.revision }, h("span", null, entry.title || entry.revision, h("span", { className: "s2p2p-meta" }, " · ", entry.revision)), h("button", { className: "s2p2p-btn", disabled: !!busy || readOnly, onClick: () => run({ type: "history.restore", historyRevision: entry.revision }) }, "Restore"))),
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
