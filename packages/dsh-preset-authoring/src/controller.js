import { PRESET_DRAFT_COMMANDS as COMMAND } from "./domain.js";

function diagnosticOf(error) {
	return Object.freeze({
		message: error instanceof Error ? error.message : String(error),
		...(error && typeof error === "object" && "code" in error ? { code: error.code } : {}),
	});
}

function categoryId(title) {
	return title.toLowerCase();
}

function projectInspection(slot, controls) {
	if (slot?.status !== "ready") return { categories: [] };
	return {
		categories: slot.value.categories.map((category) => ({
			id: categoryId(category.id),
			title: category.id,
			rows: category.rows.flatMap((row) => {
				const common = {
					title: row.metadata?.label ?? row.name,
					description: row.name,
					metadata: row.inspection,
					provenance: row.promptProvenance?.source,
					enabled: row.state.kind === "enabled",
				};
				if (row.inspection !== "verified" || row.state.kind === "conditional") {
					return [{ ...common, id: row.id, editable: false }];
				}
				const projected = [];
				const toggleId = `${row.id}:enabled`;
				controls.set(toggleId, { operation: "setEnabled", rowId: row.id });
				projected.push({ ...common, id: toggleId, control: { type: "toggle" }, editable: true });
				for (const field of row.fields) {
					const id = `${row.id}:${field.path}`;
					controls.set(id, { operation: "setField", rowId: row.id, path: field.path });
					projected.push({
						...common,
						id,
						title: `${common.title} · ${field.path}`,
						value: field.value,
						...(Object.hasOwn(row.defaults, field.path) ? { default: row.defaults[field.path] } : {}),
						control: { type: field.type === "number" ? "number" : field.type === "boolean" ? "toggle" : "text", ...(field.type === "boolean" ? { operation: "field" } : {}) },
						editable: true,
					});
				}
				return projected;
			}),
		})),
	};
}

function publicTarget(target) {
	if (!target) return null;
	return { id: target.id, editable: target.editable === true, ...(target.name ? { title: target.name } : {}) };
}

/** Translate browser commands and projections without owning a second draft. */
export function createPresetAuthoringController({ service, host, testHandoff } = {}) {
	if (!service || !host) throw new TypeError("service and host adapters are required");
	let test = Object.freeze({ status: "idle", value: null, diagnostic: null });
	let controls = new Map();

	async function syncSession(context) {
		if (typeof context?.sessionPresetId === "string" && context.sessionPresetId.length > 0
			&& service.getSnapshot().sessionPresetId !== context.sessionPresetId) {
			await service.dispatch({ type: COMMAND.SET_SESSION, presetId: context.sessionPresetId });
		}
	}

	async function panel() {
		const state = service.getSnapshot();
		controls = new Map();
		return {
			sessionPresetId: state.sessionPresetId,
			targets: (await host.listTargets()).map(publicTarget),
			target: publicTarget(state.target),
			stale: state.stale,
			inspection: projectInspection(state.inspection, controls),
			semanticDiff: state.semanticDiff,
			rawDiff: state.rawDiff,
			preflight: state.preflight,
			mount: state.mount,
			apply: state.apply,
			history: state.history,
			test,
		};
	}

	async function command(input, context = {}) {
		if (!input || typeof input.type !== "string") throw Object.assign(new TypeError("command.type is required"), { code: "INVALID_COMMAND" });
		await syncSession(context);
		switch (input.type) {
			case "panel.snapshot": break;
			case "target.open":
				await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: input.targetId });
				await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });
				break;
			case "target.copy":
				await host.copyTarget(input.sourceId, input.targetId, input.name);
				await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: input.targetId });
				await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });
				break;
			case "draft.edit": {
				await panel();
				const edit = controls.get(input.rowId);
				if (!edit || edit.operation !== "setField") throw Object.assign(new Error("row has no editable field control"), { code: "UNSUPPORTED_SEMANTIC_EDIT" });
				await service.dispatch({ type: COMMAND.EDIT_SEMANTIC, ...edit, value: input.value });
				await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });
				break;
			}
			case "draft.toggle": {
				await panel();
				const edit = controls.get(input.rowId);
				if (!edit || edit.operation !== "setEnabled") throw Object.assign(new Error("row cannot be toggled safely"), { code: "CONDITIONAL_ROW_STATE" });
				await service.dispatch({ type: COMMAND.EDIT_SEMANTIC, ...edit, enabled: input.enabled });
				await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS });
				break;
			}
			case "draft.refreshAnalysis": await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS }); break;
			case "draft.validateMount": await service.dispatch({ type: COMMAND.VALIDATE_MOUNT }); break;
			case "draft.apply": await service.dispatch({ type: COMMAND.APPLY }); break;
			case "history.load": await service.dispatch({ type: COMMAND.LOAD_HISTORY }); break;
			case "history.restore": await service.dispatch({ type: COMMAND.RESTORE_HISTORY, revision: input.revision }); break;
			case "test.start": {
				const target = service.getSnapshot().target;
				if (!target || target.id !== input.targetId) throw Object.assign(new Error("Test target must be the selected target"), { code: "TARGET_MISMATCH" });
				try {
					const value = testHandoff ? await testHandoff({ presetId: target.id, context }) : { kind: "fresh-session-handoff", presetId: target.id, currentSessionUnchanged: true };
					test = Object.freeze({ status: "ready", value, diagnostic: null });
				} catch (error) {
					test = Object.freeze({ status: "failed", value: null, diagnostic: diagnosticOf(error) });
					throw error;
				}
				break;
			}
			default: throw Object.assign(new Error(`unknown panel command: ${input.type}`), { code: "UNKNOWN_COMMAND" });
		}
		return panel();
	}
	return Object.freeze({ command, getPanelSnapshot: panel });
}
