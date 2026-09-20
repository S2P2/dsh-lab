/**
 * Presentation boundary for the adapted Preset Studio panel.
 *
 * This is the second implementation of the presenter contract introduced with
 * the semantic presenter (`createPresetPanelPresenter` in presenter.js): the
 * same two-method interface (`project`, `resolveEdit`), but a generic
 * projection modeled on DeepSeek App's Preset Studio (MIT, see UPSTREAM.md).
 * Instead of flattening known-plugin metadata into per-field controls, it
 * projects the target's Cordis composition itself:
 *
 *   - roster targets with trust provenance (display only — editability is
 *     still decided by the Host adapters, never by trust labels);
 *   - the raw `agent.cordis.yml` text of both the saved source and the shared
 *     draft (the raw-YAML view upstream lacks — a documented #65-seam content
 *     projection, path-free beyond the preset-relative file name);
 *   - the generic row editor tree (`EditorRow[]`, from preset-editor-model.js)
 *     plus a flattened, categorized read-only viewer projection;
 *   - all shared-draft lifecycle slots untouched.
 *
 * Row writes do not go through `resolveEdit` (there are no per-field control
 * ids): the browser sends the whole editor tree via the panel command
 * `draft.putRows`, which the controller serializes with the same
 * preset-editor-model/preset-yaml modules used here. The semantic presenter
 * remains fully swappable in through the same seam.
 */

import { decodePresetText } from "./tree.js";
import { editorFromRows } from "./preset-editor-model.js";
import { categorizeRow, flattenRows, isJsExpr, parsePresetYaml } from "./preset-yaml.js";

/** Preset-relative composition file name; the only path ever projected. */
export const PRESET_COMPOSITION_PATH = "agent.cordis.yml";

function publicTarget(target) {
	if (!target) return null;
	return {
		id: target.id,
		editable: target.editable === true,
		...(target.name ? { title: target.name } : {}),
		// Trust is provenance display only; editability above is authoritative.
		...(target.trust === "system" || target.trust === "user" ? { trust: target.trust } : {}),
		...(typeof target.description === "string" && target.description !== "" ? { description: target.description } : {}),
		// Presence flag only: DSH breakage messages may embed host paths.
		...(target.broken ? { broken: true } : {}),
	};
}

function compositionText(tree) {
	const file = tree?.find((entry) => entry.path === PRESET_COMPOSITION_PATH) ?? null;
	if (!file) return null;
	try {
		return decodePresetText(file);
	} catch {
		return null; // composition exists but is not UTF-8 text
	}
}

function flatRowView({ row, depth, kind }) {
	return Object.freeze({
		depth,
		kind,
		id: typeof row.id === "string" ? row.id : "",
		name: row.name,
		disabled: row.disabled === true ? true : isJsExpr(row.disabled) ? "conditional" : false,
	});
}

/** Project Host draft state into the generic, path-free Preset Studio view-model. */
export function createPresetStudioPresenter() {
	function project({ state, targets, sessionPresetId, test }) {
		const sourceText = compositionText(state.source?.tree);
		const draftText = compositionText(state.draft?.tree);
		const rows = draftText === null ? [] : parsePresetYaml(draftText);
		return Object.freeze({
			revision: state.revision,
			sourceFingerprint: state.source?.fingerprint ?? null,
			draftFingerprint: state.draft?.fingerprint ?? null,
			sessionPresetId: typeof sessionPresetId === "string" ? sessionPresetId : state.sessionPresetId,
			targets: targets.map(publicTarget),
			target: publicTarget(state.target),
			stale: state.stale,
			composition: Object.freeze({
				path: PRESET_COMPOSITION_PATH,
				present: draftText !== null,
				...(sourceText === null ? {} : { source: sourceText }),
				...(draftText === null ? {} : {
					draft: draftText,
					rows: flattenRows(rows).map(flatRowView),
					editor: editorFromRows(rows),
				}),
			}),
			semanticDiff: state.semanticDiff,
			rawDiff: state.rawDiff,
			preflight: state.preflight,
			mount: state.mount,
			apply: state.apply,
			history: state.history,
			test,
		});
	}

	function resolveEdit() {
		// The generic editor has no per-field control ids; row writes arrive
		// whole through `draft.putRows`. Any legacy control id resolves to null.
		return null;
	}

	return Object.freeze({ project, resolveEdit });
}
