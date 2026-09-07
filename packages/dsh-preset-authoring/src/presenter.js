/**
 * Presentation boundary for preset authoring.
 *
 * The Host backend (draft service, DSH host adapters, Git recovery, semantic
 * adapters) owns every state change. Presentation surfaces never touch domain
 * or flow internals: they consume the immutable view-model projected here and
 * resolve view-model control ids back into the narrow Host-supported edits.
 * `createPresetPanelPresenter()` is the stock semantic presenter; any object
 * honoring the same two-method interface can replace it (see `presenter`
 * option of `createPresetAuthoringController`), which is the seam a
 * replacement panel implements without touching backend behavior.
 */

export const PRESET_PANEL_COMMANDS = Object.freeze({
	PANEL_SNAPSHOT: "panel.snapshot",
	TARGET_OPEN: "target.open",
	TARGET_COPY: "target.copy",
	DRAFT_EDIT: "draft.edit",
	DRAFT_TOGGLE: "draft.toggle",
	DRAFT_REFRESH_ANALYSIS: "draft.refreshAnalysis",
	DRAFT_VALIDATE_MOUNT: "draft.validateMount",
	DRAFT_APPLY: "draft.apply",
	HISTORY_LOAD: "history.load",
	HISTORY_RESTORE: "history.restore",
	TEST_START: "test.start",
});

function categoryId(title) {
	return title.toLowerCase();
}

function publicTarget(target) {
	if (!target) return null;
	return { id: target.id, editable: target.editable === true, ...(target.name ? { title: target.name } : {}) };
}

/** Project Host draft state into the stable, path-free panel view-model. */
export function createPresetPanelPresenter() {
	let controls = new Map();

	function projectInspection(slot) {
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
							effectiveValue: field.effectiveValue,
							configured: field.configured,
							provenance: field.provenance,
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

	function project({ state, targets, sessionPresetId, test }) {
		controls = new Map();
		return {
			revision: state.revision,
			sourceFingerprint: state.source?.fingerprint ?? null,
			draftFingerprint: state.draft?.fingerprint ?? null,
			sessionPresetId: typeof sessionPresetId === "string" ? sessionPresetId : state.sessionPresetId,
			targets: targets.map(publicTarget),
			target: publicTarget(state.target),
			stale: state.stale,
			inspection: projectInspection(state.inspection),
			semanticDiff: state.semanticDiff,
			rawDiff: state.rawDiff,
			preflight: state.preflight,
			mount: state.mount,
			apply: state.apply,
			history: state.history,
			test,
		};
	}

	function resolveEdit(rowId) {
		return controls.get(rowId) ?? null;
	}

	return Object.freeze({ project, resolveEdit });
}
