import { PRESET_DRAFT_COMMANDS as COMMAND } from "./domain.js";
import { PRESET_PANEL_COMMANDS as PANEL, createPresetPanelPresenter } from "./presenter.js";
import { diagnosticOf } from "./diagnostic.js";

function guardOf(input) {
	return {
		targetId: input.targetId,
		expectedRevision: input.expectedRevision,
		expectedSourceFingerprint: input.expectedSourceFingerprint,
		expectedDraftFingerprint: input.expectedDraftFingerprint,
	};
}

function currentGuard(service) {
	const state = service.getSnapshot();
	return {
		targetId: state.target?.id,
		expectedRevision: state.revision,
		expectedSourceFingerprint: state.source?.fingerprint,
		expectedDraftFingerprint: state.draft?.fingerprint,
	};
}

/** Translate panel commands and presenter projections without owning a second draft. */
export function createPresetAuthoringController({ service, host, testHandoff, presenter = createPresetPanelPresenter() } = {}) {
	if (!service || !host) throw new TypeError("service and host adapters are required");
	if (typeof presenter.project !== "function" || typeof presenter.resolveEdit !== "function") {
		throw new TypeError("presenter must provide project() and resolveEdit()");
	}
	let test = Object.freeze({ status: "idle", value: null, diagnostic: null });

	async function panel(context = {}) {
		return presenter.project({
			state: service.getSnapshot(),
			targets: await host.listTargets(),
			sessionPresetId: context.sessionPresetId,
			test,
		});
	}

	async function command(input, context = {}) {
		if (!input || typeof input.type !== "string") throw Object.assign(new TypeError("command.type is required"), { code: "INVALID_COMMAND" });
		switch (input.type) {
			case PANEL.PANEL_SNAPSHOT: break;
			case PANEL.TARGET_OPEN:
				await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: input.targetId });
				await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS, ...currentGuard(service) });
				break;
			case PANEL.TARGET_COPY:
				await host.copyTarget(input.sourceId, input.targetId, input.name);
				await service.dispatch({ type: COMMAND.OPEN_TARGET, targetId: input.targetId });
				await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS, ...currentGuard(service) });
				break;
			case PANEL.DRAFT_EDIT: {
				await panel();
				const edit = presenter.resolveEdit(input.rowId);
				if (!edit || edit.operation !== "setField") throw Object.assign(new Error("row has no editable field control"), { code: "UNSUPPORTED_SEMANTIC_EDIT" });
				await service.dispatch({ type: COMMAND.EDIT_SEMANTIC, ...guardOf(input), ...edit, value: input.value });
				await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS, ...currentGuard(service) });
				break;
			}
			case PANEL.DRAFT_TOGGLE: {
				await panel();
				const edit = presenter.resolveEdit(input.rowId);
				if (!edit || edit.operation !== "setEnabled") throw Object.assign(new Error("row cannot be toggled safely"), { code: "CONDITIONAL_ROW_STATE" });
				await service.dispatch({ type: COMMAND.EDIT_SEMANTIC, ...guardOf(input), ...edit, enabled: input.enabled });
				await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS, ...currentGuard(service) });
				break;
			}
			case PANEL.DRAFT_REFRESH_ANALYSIS: await service.dispatch({ type: COMMAND.REFRESH_ANALYSIS, ...guardOf(input) }); break;
			case PANEL.DRAFT_VALIDATE_MOUNT: await service.dispatch({ type: COMMAND.VALIDATE_MOUNT, ...guardOf(input) }); break;
			case PANEL.DRAFT_APPLY: await service.dispatch({ type: COMMAND.APPLY, ...guardOf(input) }); break;
			case PANEL.HISTORY_LOAD: await service.dispatch({ type: COMMAND.LOAD_HISTORY, ...guardOf(input) }); break;
			case PANEL.HISTORY_RESTORE: await service.dispatch({ type: COMMAND.RESTORE_HISTORY, ...guardOf(input), revision: input.historyRevision }); break;
			case PANEL.TEST_START: {
				const target = service.getSnapshot().target;
				if (!target || target.id !== input.targetId) throw Object.assign(new Error("Test target must be the selected target"), { code: "TARGET_MISMATCH" });
				try {
					const value = testHandoff ? await testHandoff({ presetId: target.id, context }) : { kind: "fresh-session-required", presetId: target.id, launched: false, currentSessionUnchanged: true, message: "Create a new DSH session with this preset" };
					test = Object.freeze({ status: "ready", value, diagnostic: null });
				} catch (error) {
					test = Object.freeze({ status: "failed", value: null, diagnostic: diagnosticOf(error) });
					throw error;
				}
				break;
			}
			default: throw Object.assign(new Error(`unknown panel command: ${input.type}`), { code: "UNKNOWN_COMMAND" });
		}
		return panel(context);
	}
	return Object.freeze({ command, getPanelSnapshot: panel });
}
