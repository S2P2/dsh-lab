/**
 * Generic Cordis-row editor model for the adapted Preset Studio.
 *
 * Adapted from DeepSeek App (MIT):
 * https://github.com/RongleCat/deepseek-app
 * pinned commit e1be3e82119b85110b58f10c808076ecc7b422f4
 * `src/renderer/components/settings/PresetStudio.tsx` (EditorRow tree,
 * editorFromRows, rowsFromEditor, mutateEditor, removeEditorRow,
 * moduleShortName). Copyright (c) 2026 RongleCat, MIT license; see this
 * package's UPSTREAM.md for provenance. Local adaptation: extracted from the
 * React component into a framework-free module so the Host presenter can
 * project the editor tree and serialize edits without a second parser.
 */

import { parseYamlValue, stringifyYamlValue, toPresetRows } from "./preset-yaml.js";

/**
 * The serializable edit tree mirrored by the row editor UI.
 * @typedef {object} EditorRow
 * @property {string} key                 stable key: index path or `new-<ts>`
 * @property {string} id
 * @property {string} name
 * @property {boolean} disabled
 * @property {boolean} group
 * @property {Record<string, unknown>} isolate
 * @property {string} configText          YAML text for non-group rows
 * @property {EditorRow[]} children       nested rows for group rows
 */

/**
 * Build an editable tree from composition rows (group rows recurse).
 * @param {import("./preset-yaml.js").PresetRow[]} rows
 * @param {string} [prefix]
 * @returns {EditorRow[]}
 */
export function editorFromRows(rows, prefix = "") {
	return rows.map((r, i) => {
		const group = r.group === true;
		return {
			key: `${prefix}${i}`,
			id: r.id ?? "",
			name: r.name,
			disabled: r.disabled === true,
			group,
			isolate: r.isolate ?? {},
			configText: group ? "" : stringifyYamlValue(r.config),
			children: group ? editorFromRows(toPresetRows(r.config), `${prefix}${i}.`) : [],
		};
	});
}

/**
 * Convert the editor tree back into composition rows. Errors abort the whole
 * save: `needPackage` when a row lacks a package name, `badConfig` when a row
 * config textarea is not YAML this adapter can parse.
 * @param {EditorRow[]} rows
 * @returns {{ rows: import("./preset-yaml.js").PresetRow[], error: string | null }}
 */
export function rowsFromEditor(rows) {
	/** @type {import("./preset-yaml.js").PresetRow[]} */
	const out = [];
	for (const er of rows) {
		const name = er.name.trim();
		if (!name) return { rows: [], error: "needPackage" };
		/** @type {import("./preset-yaml.js").PresetRow} */
		const row = { name };
		if (er.id.trim()) row.id = er.id.trim();
		if (er.disabled) row.disabled = true;
		if (er.group) {
			row.group = true;
			if (Object.keys(er.isolate).length > 0) row.isolate = er.isolate;
			const nested = rowsFromEditor(er.children);
			if (nested.error) return nested;
			row.config = nested.rows; // group config = nested rows
		} else {
			const text = er.configText.trim();
			if (text !== "") {
				const v = parseYamlValue(text);
				if (v === undefined) return { rows: [], error: "badConfig" };
				row.config = v;
			}
		}
		out.push(row);
	}
	return { rows: out, error: null };
}

/**
 * Immutably patch one editor row (recursing through group children) by key.
 * @param {EditorRow[]} rows
 * @param {string} key
 * @param {Partial<EditorRow>} patch
 * @returns {EditorRow[]}
 */
export function mutateEditor(rows, key, patch) {
	return rows.map((r) => {
		if (r.key === key) return { ...r, ...patch };
		if (r.children.length) return { ...r, children: mutateEditor(r.children, key, patch) };
		return r;
	});
}

/**
 * Immutably drop one editor row (recursing through group children) by key.
 * @param {EditorRow[]} rows
 * @param {string} key
 * @returns {EditorRow[]}
 */
export function removeEditorRow(rows, key) {
	return rows.filter((r) => r.key !== key).map((r) => (r.children.length ? { ...r, children: removeEditorRow(r.children, key) } : r));
}

/**
 * Strip scope/`cordis:`/`cordis-plugin-`/`dsh-(host-|client-)?` prefixes for
 * display.
 * @param {string} moduleName
 * @returns {string}
 */
export function moduleShortName(moduleName) {
	return (moduleName.startsWith("@") ? moduleName.slice(moduleName.indexOf("/") + 1) : moduleName)
		.replace(/^cordis:/, "")
		.replace(/^cordis-plugin-/, "")
		.replace(/^dsh-(?:host-|client-)?/, "");
}
