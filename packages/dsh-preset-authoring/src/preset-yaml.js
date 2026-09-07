/**
 * Focused YAML subset parser / stringifier for agent-preset `cordis.yml`
 * compositions.
 *
 * Adapted nearly verbatim from DeepSeek App (MIT):
 * https://github.com/RongleCat/deepseek-app
 * pinned commit e1be3e82119b85110b58f10c808076ecc7b422f4
 * `src/renderer/lib/presetYaml.ts`. Copyright (c) 2026 RongleCat, MIT license;
 * see this package's UPSTREAM.md for provenance and the upstream-sync
 * re-diff instruction. Local adaptations: TypeScript types stripped to JSDoc;
 * the `dsh --dump-config` projection (`parseDumpLayers`) is deliberately
 * dropped — this plugin never derives paths or provenance from config dumps;
 * and `parseYamlValue` additionally rejects unbalanced flow collections (see
 * there) so the row editor's `badConfig` save-abort is a real behavior.
 *
 * DSH preset compositions are a top-level list of plugin rows, where each row
 * is a mapping carrying `id`, `name`, an optional `config` (scalar / mapping /
 * nested group list), `disabled`, `group`, and `isolate`.
 *
 * This is deliberately NOT a general YAML parser — upstream's renderer cannot
 * depend on `js-yaml`/`yaml` (they are transitive, not hoisted) and this
 * package keeps the ported module dependency-free so the exact same subset
 * semantics stay available to any consumer. It only implements the constructs
 * that actually appear in compositions:
 *
 *   - top-level and nested sequences (`- item`) and block mappings (`key: …`)
 *   - plain / single- / double-quoted scalars with boolean / number / null
 *   - `!!js` tagged scalars (the `entryListSchema` dialect from cordis include)
 *   - literal (`|`) and folded (`>`) block scalars, with `-`/`+` chomping
 *   - `#` full-line comments and blank lines (ignored outside block scalars)
 */

/**
 * A `!!js <expr>` tagged scalar, kept inert; the expression is never evaluated.
 * @typedef {object} JsExpr
 * @property {string} __jsExpr
 */

/**
 * One Cordis composition row. `config` is opaque: scalar, mapping, or — for
 * `group` rows — a nested row list.
 * @typedef {object} PresetRow
 * @property {string} [id]
 * @property {string} name
 * @property {boolean|JsExpr} [disabled]
 * @property {boolean} [group]
 * @property {Record<string, unknown>} [isolate]
 * @property {unknown} [config]
 */

/** @typedef {string|number|boolean|null|JsExpr} Scalar */
/** @typedef {Record<string, unknown>} MapValue */

/**
 * Detect an inert `!!js` tagged scalar.
 * @param {unknown} v
 * @returns {v is JsExpr}
 */
export function isJsExpr(v) {
	return !!v && typeof v === "object" && "__jsExpr" in /** @type {Record<string, unknown>} */ (v);
}

// ── parse ───────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Line
 * @property {number} indent
 * @property {string} text
 * @property {string} raw
 */

/**
 * @param {string} text
 * @returns {Line[]}
 */
function tokenize(text) {
	const out = [];
	for (const raw of text.split("\n")) {
		const m = /^([ \t]*)(.*)$/.exec(raw);
		if (!m) continue;
		const indent = m[1].replace(/\t/g, "  ").length;
		out.push({ indent, text: m[2], raw });
	}
	return out;
}

class Parser {
	i = 0;

	/** @param {Line[]} lines */
	constructor(lines) {
		this.lines = lines;
	}

	/** @returns {Line|undefined} */
	peek() {
		return this.lines[this.i];
	}

	/** Advance past blank lines and full-line comments. */
	skipNoise() {
		while (this.i < this.lines.length) {
			const t = this.lines[this.i].text.trim();
			if (t === "" || t.startsWith("#")) this.i += 1;
			else break;
		}
	}

	/** @param {number} indent */
	atIndent(indent) {
		const line = this.peek();
		return !!line && line.indent === indent;
	}

	parseDocument() {
		this.skipNoise();
		if (this.i >= this.lines.length) return [];
		const line = this.lines[this.i];
		if (line.text.startsWith("- ")) return this.parseList(line.indent);
		return this.parseMap(line.indent);
	}

	/** A block mapping: `key: value` / `key:` entries at the given indent.
	 * @param {number} indent
	 * @returns {MapValue}
	 */
	parseMap(indent) {
		const out = {};
		this.skipNoise();
		while (this.atIndent(indent)) {
			const line = this.lines[this.i];
			const text = line.text;
			if (text.startsWith("- ")) break;
			const colon = findKeyColon(text);
			if (colon < 0) break; // unexpected; stop rather than misparse
			const key = text.slice(0, colon).trim();
			const rest = text.slice(colon + 1).trim();
			this.i += 1;
			out[key] = this.parseMapValue(indent, rest);
			this.skipNoise();
		}
		return out;
	}

	/**
	 * Parse the value for a `key:` entry already consumed; `rest` is the inline remainder.
	 * @param {number} keyIndent
	 * @param {string} rest
	 */
	parseMapValue(keyIndent, rest) {
		if (rest === "") {
			this.skipNoise();
			const next = this.peek();
			if (!next || next.indent <= keyIndent) return null;
			if (next.text.startsWith("- ")) return this.parseList(next.indent);
			return this.parseMap(next.indent);
		}
		if (isBlockHeader(rest)) return this.parseBlockScalar(keyIndent, rest);
		return this.parseScalar(rest);
	}

	/** A block sequence: `- item` at the given indent.
	 * @param {number} indent
	 * @returns {unknown[]}
	 */
	parseList(indent) {
		const out = [];
		this.skipNoise();
		while (this.atIndent(indent)) {
			const line = this.lines[this.i];
			if (!line.text.startsWith("- ")) break;
			out.push(this.parseListItem(indent));
			this.skipNoise();
		}
		return out;
	}

	/** @param {number} indent */
	parseListItem(indent) {
		const line = this.lines[this.i];
		const rest = line.text.slice(2).trim(); // after "- "
		this.i += 1;
		const colon = findKeyColon(rest);
		if (colon < 0) {
			// `- scalar` (not used for rows, but tolerate it)
			return this.parseScalar(rest);
		}
		const key = rest.slice(0, colon).trim();
		const after = rest.slice(colon + 1).trim();
		// A row mapping continues at `indent + 2` (the "- " width).
		const innerIndent = indent + 2;
		const first = {};
		first[key] = this.parseMapValue(innerIndent, after);
		const rest2 = this.parseContinuation(innerIndent, first);
		return rest2;
	}

	/**
	 * Continue a mapping after its first `- key:` entry, at `indent`.
	 * @param {number} indent
	 * @param {MapValue} seed
	 * @returns {MapValue}
	 */
	parseContinuation(indent, seed) {
		const out = seed;
		this.skipNoise();
		while (this.atIndent(indent)) {
			const line = this.lines[this.i];
			const text = line.text;
			if (text.startsWith("- ")) break;
			const colon = findKeyColon(text);
			if (colon < 0) break;
			const key = text.slice(0, colon).trim();
			const rest = text.slice(colon + 1).trim();
			this.i += 1;
			out[key] = this.parseMapValue(indent, rest);
			this.skipNoise();
		}
		return out;
	}

	/**
	 * Parse a block scalar whose header (`|`, `>`, `|-`, …) was already seen.
	 * @param {number} keyIndent
	 * @param {string} header
	 * @returns {string}
	 */
	parseBlockScalar(keyIndent, header) {
		const folded = header[0] === ">";
		const chomp = header.slice(1); // "", "-", "+" (ignoring indentation indicator)
		const content = [];
		while (this.i < this.lines.length) {
			const line = this.lines[this.i];
			if (line.text.trim() === "" || line.text.trim().startsWith("#")) {
				// Blank / comment lines inside a block scalar are content, but only
				// when a following more-indented line still belongs to the scalar.
				// Keep it simple: stop when the next non-empty line dedents.
				const j = this.i;
				const next = this.findNextNonEmpty();
				if (next === undefined || next.indent <= keyIndent) break;
				content.push(line.raw);
				this.i = j + 1;
				continue;
			}
			if (line.indent <= keyIndent) break;
			content.push(line.text);
			this.i += 1;
		}
		let joined = content.join("\n");
		if (folded) joined = joined.replace(/[ \t]*\n[ \t]+/g, " ").replace(/\n{2,}/g, "\n");
		if (chomp === "-") joined = joined.replace(/\n+$/, "");
		else if (chomp === "") joined = joined.replace(/\n*$/, "") + "\n";
		else if (chomp === "+") joined = joined.replace(/\n*$/, "") + "\n";
		return joined;
	}

	/** @returns {Line|undefined} */
	findNextNonEmpty() {
		for (let j = this.i; j < this.lines.length; j += 1) {
			if (this.lines[j].text.trim() !== "" && !this.lines[j].text.trim().startsWith("#")) {
				return this.lines[j];
			}
		}
		return undefined;
	}

	/** @param {string} text @returns {Scalar} */
	parseScalar(text) {
		const t = text.trim();
		if (t.startsWith("!!js")) return { __jsExpr: t.slice(4).trim() };
		if (t.startsWith("'") || t.startsWith('"')) return parseQuoted(t);
		if (t === "true") return true;
		if (t === "false") return false;
		if (t === "null" || t === "~") return null;
		if (t === "") return "";
		const num = Number(t);
		if (t !== "" && Number.isFinite(num) && !/^[+-]?0x/i.test(t)) return num;
		return t;
	}
}

/**
 * First top-level colon not inside quotes.
 * @param {string} text
 */
function findKeyColon(text) {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < text.length; i += 1) {
		const c = text[i];
		if (c === "'" && !inDouble) inSingle = !inSingle;
		else if (c === '"' && !inSingle) inDouble = !inDouble;
		else if (c === ":" && !inSingle && !inDouble) return i;
	}
	return -1;
}

/** @param {string} t */
function parseQuoted(t) {
	if (t.startsWith('"')) {
		let out = "";
		for (let i = 1; i < t.length; i += 1) {
			const c = t[i];
			if (c === '"') break;
			if (c === "\\" && i + 1 < t.length) {
				const n = t[i + 1];
				out += n === "n" ? "\n" : n === "t" ? "\t" : n === '"' ? '"' : n === "\\" ? "\\" : n;
				i += 1;
			} else out += c;
		}
		return out;
	}
	// single-quoted: only '' → '
	return t.slice(1).replace(/^'|'$/g, "").replace(/''/g, "'");
}

/** @param {string} t */
function isBlockHeader(t) {
	return /^[|>][+-]?\d*$/.test(t) || /^[|>][+-]?\d*[ \t]*#/.test(t);
}

/**
 * Convert a parsed nested config value into preset rows (groups recurse).
 * @param {unknown} value
 * @returns {PresetRow[]}
 */
export function toPresetRows(value) {
	return toRows(value);
}

/**
 * @param {unknown} value
 * @returns {PresetRow[]}
 */
function toRows(value) {
	if (!Array.isArray(value)) return [];
	const rows = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const rec = /** @type {MapValue} */ (item);
		if (typeof rec.name !== "string" || rec.name === "") continue;
		/** @type {PresetRow} */
		const row = { name: rec.name };
		if (typeof rec.id === "string") row.id = rec.id;
		if (typeof rec.disabled === "boolean") row.disabled = rec.disabled;
		else if (isJsExpr(rec.disabled)) row.disabled = rec.disabled;
		if (rec.group === true) row.group = true;
		if (rec.isolate && typeof rec.isolate === "object" && !Array.isArray(rec.isolate)) {
			row.isolate = rec.isolate;
		}
		if ("config" in rec) row.config = rec.config;
		rows.push(row);
	}
	return rows;
}

/**
 * Parse an agent-preset composition into its plugin rows (groups recurse).
 * Returns `[]` on any parse throw, mirroring the upstream guarantee.
 * @param {string} text
 * @returns {PresetRow[]}
 */
export function parsePresetYaml(text) {
	try {
		const doc = new Parser(tokenize(text)).parseDocument();
		return toRows(doc);
	} catch {
		return [];
	}
}

/**
 * Local adaptation beyond the upstream subset: compositions contain no flow
 * collections, and a config textarea with unbalanced `[`/`{` can never
 * serialize back faithfully — upstream's lenient parser would silently turn it
 * into a plain string. Treat that as a parse error so the row editor's
 * `badConfig` save-abort is a real behavior. Quoted spans are skipped; this is
 * a definite-error heuristic, not a general YAML validator.
 * @param {string} text
 */
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

/**
 * Parse a single YAML value (used for editing one row's `config` block).
 * Returns `undefined` on error so callers can abort saves with `badConfig`.
 * Reading stays lenient (`parsePresetYaml`); only the edit-write path rejects
 * definite errors.
 * @param {string} text
 * @returns {unknown}
 */
export function parseYamlValue(text) {
	try {
		if (!balancedFlowCollections(text)) return undefined;
		return new Parser(tokenize(text)).parseDocument();
	} catch {
		return undefined;
	}
}

/**
 * Serialize a single value to a compact YAML text (used for config textareas).
 * @param {unknown} v
 * @returns {string}
 */
export function stringifyYamlValue(v) {
	if (v === undefined) return "";
	return emitValue(v, 0).trimEnd();
}

// ── stringify ───────────────────────────────────────────────────────────────

/** @param {string} s */
function needsQuote(s) {
	if (s === "") return true;
	if (/^[ ]/.test(s) || /[ ]$/.test(s) || /[\n]/.test(s)) return true;
	if (/^[!&*{[\],#|>@`"'\-?:]/.test(s) || /[:#][ ]/.test(s)) return true;
	if (/^(true|false|null|~)$/i.test(s) || /^[-+]?(\d|\.\d)/.test(s)) return true;
	return false;
}

/** @param {string} s */
function quote(s) {
	if (s.includes("'")) return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	return `'${s}'`;
}

/** @param {Scalar} v */
function scalarText(v) {
	if (isJsExpr(v)) return `!!js ${v.__jsExpr}`;
	if (v === null) return "null";
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "number") return String(v);
	return needsQuote(v) ? quote(v) : v;
}

/**
 * @param {string} text
 * @param {string} indent
 */
function emitBlockScalar(text, indent) {
	// Literal block scalar, chomped: keeps internal newlines, no trailing blank.
	const lines = text.replace(/\n+$/, "").split("\n");
	return `|-\n${lines.map((l) => `${indent}  ${l}`).join("\n")}`;
}

/**
 * @param {unknown} v
 * @param {number} indent
 */
function emitValue(v, indent) {
	const pad = " ".repeat(indent);
	if (isJsExpr(v)) return `${pad}${scalarText(v)}`;
	if (v === null || v === undefined) return `${pad}null`;
	if (typeof v === "boolean" || typeof v === "number") return `${pad}${scalarText(v)}`;
	if (typeof v === "string") {
		if (v.includes("\n")) return `${pad}${emitBlockScalar(v, pad)}`;
		return `${pad}${scalarText(v)}`;
	}
	if (Array.isArray(v)) {
		if (v.length === 0) return `${pad}[]`;
		return v
			.map((item) => {
				if (item && typeof item === "object" && !Array.isArray(item) && !isJsExpr(item)) {
					return emitMapItem(/** @type {MapValue} */ (item), indent);
				}
				return `${pad}- ${emitValue(item, indent).trimStart()}`;
			})
			.join("\n");
	}
	if (typeof v === "object") {
		const rec = /** @type {MapValue} */ (v);
		const keys = Object.keys(rec);
		if (keys.length === 0) return `${pad}{}`;
		return keys.map((k) => `${pad}${k}: ${emitInline(rec[k], indent, k)}`).join("\n");
	}
	return `${pad}${String(v)}`;
}

/**
 * @param {unknown} v
 * @param {number} indent
 * @param {string} key
 */
function emitInline(v, indent, key) {
	if (isJsExpr(v)) return `!!js ${v.__jsExpr}`;
	if (v === null || v === undefined) return "null";
	if (typeof v === "boolean" || typeof v === "number") return scalarText(v);
	if (typeof v === "string") {
		if (v.includes("\n")) return emitBlockScalar(v, " ".repeat(indent));
		return scalarText(v);
	}
	if (Array.isArray(v)) {
		if (v.length === 0) return "[]";
		const child = v[0];
		if (child && typeof child === "object" && !Array.isArray(child) && !isJsExpr(child)) {
			return "\n" + emitValue(v, indent + 2);
		}
		return "\n" + v.map((item) => `${" ".repeat(indent + 2)}- ${emitInline(item, indent + 2, key).trimStart()}`).join("\n");
	}
	if (typeof v === "object") {
		const rec = /** @type {MapValue} */ (v);
		const keys = Object.keys(rec);
		if (keys.length === 0) return "{}";
		return "\n" + keys.map((k) => `${" ".repeat(indent + 2)}${k}: ${emitInline(rec[k], indent + 2, k)}`).join("\n");
	}
	return String(v);
}

/**
 * @param {MapValue} rec
 * @param {number} indent
 */
function emitMapItem(rec, indent) {
	const innerPad = " ".repeat(indent + 2);
	const lines = [];
	const order = ["id", "name", "disabled", "group", "isolate", "config"];
	const seen = new Set();
	let first = true;
	const emitOne = (key, value) => {
		const line = emitEntryLine(innerPad, indent + 2, key, value);
		lines.push(first ? `${" ".repeat(indent)}- ${line.trimStart()}` : line);
		first = false;
	};
	for (const key of order) {
		if (!(key in rec)) continue;
		seen.add(key);
		emitOne(key, rec[key]);
	}
	for (const key of Object.keys(rec)) {
		if (seen.has(key)) continue;
		emitOne(key, rec[key]);
	}
	return lines.join("\n");
}

/**
 * @param {string} pad
 * @param {number} indent
 * @param {string} key
 * @param {unknown} value
 */
function emitEntryLine(pad, indent, key, value) {
	if (value === undefined) return `${pad}${key}:`;
	if (isJsExpr(value)) return `${pad}${key}: !!js ${value.__jsExpr}`;
	if (value === null || typeof value === "boolean" || typeof value === "number") {
		return `${pad}${key}: ${scalarText(value)}`;
	}
	if (typeof value === "string") {
		if (value.includes("\n")) return `${pad}${key}: ${emitBlockScalar(value, pad)}`;
		return `${pad}${key}: ${scalarText(value)}`;
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return `${pad}${key}: []`;
		return `${pad}${key}:\n${emitValue(value, indent + 2)}`;
	}
	if (typeof value === "object") {
		const keys = Object.keys(/** @type {MapValue} */ (value));
		if (keys.length === 0) return `${pad}${key}: {}`;
		return `${pad}${key}:\n${emitValue(value, indent + 2)}`;
	}
	return `${pad}${key}: ${String(value)}`;
}

/**
 * @param {PresetRow} row
 * @returns {MapValue}
 */
function rowToMap(row) {
	/** @type {MapValue} */
	const rec = { name: row.name };
	if (row.id !== undefined) rec.id = row.id;
	if (row.disabled !== undefined) rec.disabled = row.disabled;
	if (row.group === true) rec.group = true;
	if (row.isolate !== undefined) rec.isolate = row.isolate;
	if (row.config !== undefined) rec.config = row.config;
	return rec;
}

/**
 * Serialize preset rows back to a cordis.yml document.
 *
 * Fidelity limit (upstream-pinned): comments are dropped, key order is
 * normalized to the canonical row order, quoting style may change, and folded
 * scalars re-emit as literal `|-` blocks. Round-trips preserve flattened row
 * identity (`depth:id:name:kind`) — nothing stronger.
 * @param {PresetRow[]} rows
 * @returns {string}
 */
export function stringifyPresetYaml(rows) {
	const maps = rows.map(rowToMap);
	if (maps.length === 0) return "[]\n";
	return maps.map((m) => emitMapItem(m, 0)).join("\n") + "\n";
}

// ── row categorization ──────────────────────────────────────────────────────

/** Display-only row classification for the composition viewer.
 * @typedef {"tool"|"prompt"|"delegation"|"group"|"other"} RowKind
 */

/**
 * Classify a preset row by its plugin name for the composition viewer.
 * This is a display-only name-substring classifier, not a semantic model.
 * @param {string} name
 * @param {boolean} [group]
 * @returns {RowKind}
 */
export function categorizeRow(name, group = false) {
	if (group || name === "cordis:group") return "group";
	if (
		name.includes("dsh-persona") ||
		name.includes("dsh-agent-instructions") ||
		name.includes("dsh-plan-mode") ||
		name.includes("dsh-compaction") ||
		name.includes("dsh-tool-result-pruner") ||
		name.includes("dsh-command-compact")
	) return "prompt";
	if (
		name.includes("subagent") ||
		name.includes("workflow") ||
		name.includes("ralph")
	) return "delegation";
	if (
		name.includes("-tool-") ||
		name.includes("dsh-tool") ||
		name.includes("dsh-agent-tool") ||
		name.includes("dsh-terminal")
	) return "tool";
	return "other";
}

/** A flattened row with its group depth and display kind.
 * @typedef {object} FlatRow
 * @property {PresetRow} row
 * @property {number} depth
 * @property {RowKind} kind
 */

/**
 * Flatten rows (recursing into groups) with their group path for display.
 * @param {PresetRow[]} rows
 * @param {number} [depth]
 * @returns {FlatRow[]}
 */
export function flattenRows(rows, depth = 0) {
	const out = [];
	for (const row of rows) {
		out.push({ row, depth, kind: categorizeRow(row.name, row.group === true) });
		if (Array.isArray(row.config) && row.group === true) {
			const nested = toRows(row.config);
			out.push(...flattenRows(nested, depth + 1));
		}
	}
	return out;
}
