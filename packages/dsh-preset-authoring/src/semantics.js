import { isMap, isScalar, isSeq, parseDocument, stringify } from "yaml";
import { decodePresetText } from "./tree.js";

export const SEMANTIC_CATEGORIES = Object.freeze([
	"Prompt", "Model", "Plugins", "Skills", "Tools", "MCP", "Other",
]);

const JS_TAG = "tag:yaml.org,2002:js";
const yamlOptions = Object.freeze({
	customTags: [{ tag: JS_TAG, resolve: (source) => source }],
	prettyErrors: false,
	uniqueKeys: false,
});

const BUILTIN_PLUGINS = Object.freeze({
	"@deepseek-ai/dsh-persona": {
		category: "Prompt",
		label: "Persona",
		fields: { "config.text": { type: "string" } },
		prompt: { kind: "persona", source: "config.text" },
	},
	"@deepseek-ai/dsh-agent-instructions": {
		category: "Prompt",
		label: "Workspace instructions",
		fields: { "config.maxBytes": { type: "number" } },
		prompt: { kind: "workspace-instructions", source: "workspace instruction files" },
	},
	"@deepseek-ai/dsh-plan-mode": {
		category: "Prompt",
		label: "Plan mode prompt section",
		fields: { "config.section": { type: "string" } },
		prompt: { kind: "plan-mode-section", source: "config.section" },
	},
	"@deepseek-ai/dsh-skill-filesystem": {
		category: "Skills",
		label: "Filesystem skills",
		fields: {},
	},
	"@deepseek-ai/dsh-tool-web": {
		category: "Tools",
		label: "Web tools",
		fields: {
			"config.fetch": { type: "boolean" },
			"config.searchTimeoutMs": { type: "number" },
		},
	},
	"@deepseek-ai/dsh-tool-fs-search": {
		category: "Tools",
		label: "Filesystem search tools",
		fields: { "config.sampleOverCapGlobResults": { type: "boolean" } },
	},
	"@deepseek-ai/dsh-tool-todo": {
		category: "Tools",
		label: "Todo tool",
		fields: { "config.allowParallelInProgress": { type: "boolean" } },
	},
	"@deepseek-ai/dsh-compaction-tool-result-pruner": {
		category: "Other",
		label: "Tool result pruner",
		fields: {
			"config.thresholdChars": { type: "number" },
			"config.headChars": { type: "number" },
			"config.tailChars": { type: "number" },
		},
	},
});

const KNOWN_TOOL_PLUGINS = new Set([
	"@deepseek-ai/dsh-tool-ask-user",
	"@deepseek-ai/dsh-tool-bash",
	"@deepseek-ai/dsh-tool-cordis",
	"@deepseek-ai/dsh-tool-fs",
	"@deepseek-ai/dsh-tool-goal",
	"@deepseek-ai/dsh-tool-jobs",
	"@deepseek-ai/dsh-tool-pwsh",
	"@deepseek-ai/dsh-tool-ralph",
	"@deepseek-ai/dsh-tool-skill",
	"@deepseek-ai/dsh-tool-subagent",
	"@deepseek-ai/dsh-tool-subagent-control",
	"@deepseek-ai/dsh-tool-subagent-control/list-agents",
	"@deepseek-ai/dsh-tool-workflow",
]);

function metadataFor(name, plugins) {
	if (plugins && Object.hasOwn(plugins, name)) return plugins[name];
	if (Object.hasOwn(BUILTIN_PLUGINS, name)) return BUILTIN_PLUGINS[name];
	if (KNOWN_TOOL_PLUGINS.has(name)) return { category: "Tools", label: name, fields: {} };
	if (name === "@deepseek-ai/dsh-mcp-client") return { category: "MCP", label: "MCP client", fields: {} };
	return null;
}

function parseComposition(source) {
	return parseDocument(source, yamlOptions);
}

function pairOf(map, key) {
	return isMap(map) ? map.items.find((pair) => isScalar(pair.key) && pair.key.value === key) : undefined;
}

function scalarValue(map, key) {
	const node = pairOf(map, key)?.value;
	return isScalar(node) ? node.value : undefined;
}

function nodeAtPath(row, path) {
	let node = row;
	for (const segment of path.split(".")) {
		const pair = pairOf(node, segment);
		if (!pair) return null;
		node = pair.value;
	}
	return node;
}

function collectRows(doc) {
	const rows = [];
	function visit(sequence) {
		if (!isSeq(sequence)) return;
		for (const row of sequence.items) {
			if (!isMap(row)) continue;
			rows.push(row);
			const config = pairOf(row, "config")?.value;
			if (isSeq(config)) visit(config);
		}
	}
	visit(doc.contents);
	return rows;
}

function stateOf(row) {
	const disabled = pairOf(row, "disabled")?.value;
	if (!disabled) return Object.freeze({ kind: "enabled" });
	if (disabled.tag === JS_TAG) {
		return Object.freeze({ kind: "conditional", expression: String(disabled.value) });
	}
	if (isScalar(disabled) && disabled.value === true) return Object.freeze({ kind: "disabled" });
	if (isScalar(disabled) && disabled.value === false) return Object.freeze({ kind: "enabled" });
	return Object.freeze({ kind: "conditional", expression: String(disabled?.value ?? "unknown") });
}

function categoryFor(name, metadata) {
	if (metadata?.category && SEMANTIC_CATEGORIES.includes(metadata.category)) return metadata.category;
	if (name === "cordis:group") return "Other";
	return "Plugins";
}

function inspectText(source, options = {}) {
	const doc = parseComposition(source);
	const categories = SEMANTIC_CATEGORIES.map((id) => ({ id, rows: [] }));
	if (doc.errors.length || !isSeq(doc.contents)) return { categories, document: doc, rowNodes: [] };
	const rowNodes = collectRows(doc);
	for (const node of rowNodes) {
		const id = scalarValue(node, "id");
		const name = scalarValue(node, "name");
		if (typeof id !== "string" || typeof name !== "string") continue;
		const metadata = metadataFor(name, options.plugins);
		const category = categoryFor(name, metadata);
		const fields = [];
		const defaults = {};
		for (const [path, field] of Object.entries(metadata?.fields ?? {})) {
			const valueNode = nodeAtPath(node, path);
			if (isScalar(valueNode) && valueNode.tag !== JS_TAG) fields.push({ path, type: field.type, value: valueNode.value });
			if (Object.hasOwn(field, "default")) defaults[path] = field.default;
		}
		const row = {
			id,
			name,
			category,
			state: stateOf(node),
			inspection: metadata ? "verified" : "uninspected",
			metadata: metadata ? { label: metadata.label ?? name } : null,
			defaults,
			fields,
			promptProvenance: metadata?.prompt ? {
				kind: metadata.prompt.kind,
				producer: name,
				source: metadata.prompt.source,
				scope: "authoring-time",
			} : null,
		};
		categories.find((entry) => entry.id === category).rows.push(row);
	}
	return { categories, document: doc, rowNodes };
}

function compositionFile(tree) {
	const file = tree.find((entry) => entry.path === "agent.cordis.yml");
	if (!file) return null;
	try {
		return { file, source: decodePresetText(file) };
	} catch {
		return { file, source: null };
	}
}

export function inspectPreset(input, options = {}) {
	const composition = compositionFile(input.draft.tree);
	if (!composition || composition.source === null) {
		return { categories: SEMANTIC_CATEGORIES.map((id) => ({ id, rows: [] })) };
	}
	const { categories } = inspectText(composition.source, options);
	return { categories };
}

function diagnostic(code, message, extra = {}) {
	return { severity: "error", code, message, ...extra };
}

export function preflightPreset(input) {
	const composition = compositionFile(input.draft.tree);
	if (!composition) return { valid: false, diagnostics: [diagnostic("MISSING_COMPOSITION", "agent.cordis.yml is missing")] };
	if (composition.source === null) return { valid: false, diagnostics: [diagnostic("COMPOSITION_NOT_TEXT", "agent.cordis.yml is not UTF-8 text")] };
	const doc = parseComposition(composition.source);
	const diagnostics = doc.errors.map((error) => diagnostic("YAML_PARSE_ERROR", error.message, error.linePos?.[0] ? {
		line: error.linePos[0].line,
		column: error.linePos[0].col,
	} : {}));
	if (!doc.errors.length && !isSeq(doc.contents)) {
		diagnostics.push(diagnostic("COMPOSITION_NOT_SEQUENCE", "agent.cordis.yml must contain a top-level row sequence"));
	}
	if (!diagnostics.length) {
		const ids = new Set();
		let position = 0;
		function validateRows(sequence) {
			for (const row of sequence.items) {
				position++;
				if (!isMap(row)) {
					diagnostics.push(diagnostic("ROW_NOT_MAPPING", `composition row ${position} must be a mapping`));
					continue;
				}
				const id = scalarValue(row, "id");
				const name = scalarValue(row, "name");
				if (typeof id !== "string" || id.length === 0) diagnostics.push(diagnostic("ROW_ID_INVALID", `composition row ${position} needs a string id`));
				else if (ids.has(id)) diagnostics.push(diagnostic("ROW_ID_DUPLICATE", `duplicate composition row id: ${id}`, { rowId: id }));
				else ids.add(id);
				if (typeof name !== "string" || name.length === 0) diagnostics.push(diagnostic("ROW_NAME_INVALID", `composition row ${position} needs a string name`, { rowId: id }));
				const config = pairOf(row, "config")?.value;
				if (config && !isMap(config) && !isSeq(config)) diagnostics.push(diagnostic("ROW_CONFIG_INVALID", `config for ${id ?? `row ${position}`} must be a mapping or nested row sequence`, { rowId: id }));
				if (isSeq(config)) validateRows(config);
			}
		}
		validateRows(doc.contents);
	}
	return { valid: diagnostics.length === 0, diagnostics };
}

function editError(code, message) {
	return Object.assign(new Error(message), { code });
}

function replacementFor(source, node, value) {
	if (!["string", "number", "boolean"].includes(typeof value) && value !== null) {
		throw editError("UNSUPPORTED_SEMANTIC_EDIT", "semantic fields support only scalar string, number, boolean, or null values");
	}
	const rendered = stringify(value, { lineWidth: 0 }).trimEnd();
	if (!rendered.includes("\n")) return rendered;
	const lineStart = source.lastIndexOf("\n", node.range[0] - 1) + 1;
	const leading = source.slice(lineStart, node.range[0]).match(/^\s*/)?.[0] ?? "";
	const indented = rendered.replaceAll("\n", `\n${leading}  `);
	return source.slice(node.range[0], node.range[1]).endsWith("\n") ? `${indented}\n` : indented;
}

function replaceRange(source, range, replacement) {
	return source.slice(0, range[0]) + replacement + source.slice(range[1]);
}

function editText(source, edit, options) {
	const inspected = inspectText(source, options);
	if (inspected.document.errors.length || !isSeq(inspected.document.contents)) {
		throw editError("INVALID_COMPOSITION", "cannot semantically edit an invalid composition");
	}
	const matches = inspected.rowNodes.filter((row) => scalarValue(row, "id") === edit.rowId);
	if (matches.length !== 1) throw editError("AMBIGUOUS_ROW", `expected exactly one existing row with id ${JSON.stringify(edit.rowId)}`);
	const row = matches[0];
	const name = scalarValue(row, "name");
	if (edit.operation === "setField") {
		const metadata = typeof name === "string" ? metadataFor(name, options.plugins) : null;
		if (!metadata || !Object.hasOwn(metadata.fields ?? {}, edit.path)) {
			throw editError("UNSUPPORTED_SEMANTIC_EDIT", `field ${JSON.stringify(edit.path)} is not exposed by verified metadata for ${name ?? edit.rowId}`);
		}
		const node = nodeAtPath(row, edit.path);
		if (!isScalar(node) || node.tag === JS_TAG) {
			throw editError("UNSUPPORTED_SEMANTIC_EDIT", `field ${JSON.stringify(edit.path)} is not an existing plain scalar`);
		}
		const expectedType = metadata.fields[edit.path].type;
		if (edit.value !== null && expectedType && typeof edit.value !== expectedType) {
			throw editError("UNSUPPORTED_SEMANTIC_EDIT", `field ${JSON.stringify(edit.path)} requires a ${expectedType} value`);
		}
		return replaceRange(source, node.range, replacementFor(source, node, edit.value));
	}
	if (edit.operation === "setEnabled") {
		if (typeof edit.enabled !== "boolean") throw editError("UNSUPPORTED_SEMANTIC_EDIT", "enabled must be boolean");
		const disabled = pairOf(row, "disabled")?.value;
		if (disabled?.tag === JS_TAG || (disabled && (!isScalar(disabled) || typeof disabled.value !== "boolean"))) {
			throw editError("CONDITIONAL_ROW_STATE", `row ${edit.rowId} has conditional disabled state and cannot be toggled safely`);
		}
		if (disabled) return replaceRange(source, disabled.range, edit.enabled ? "false" : "true");
		if (edit.enabled) return source;
		const lineStart = source.lastIndexOf("\n", row.range[0] - 1) + 1;
		const indent = source.slice(lineStart, row.range[0]).replace(/[^ \t]/g, " ");
		return source.slice(0, row.range[1]) + `${indent}disabled: true\n` + source.slice(row.range[1]);
	}
	throw editError("UNSUPPORTED_SEMANTIC_EDIT", `unknown semantic edit operation: ${JSON.stringify(edit.operation)}`);
}

export function editPreset(input, edit, options = {}) {
	const composition = compositionFile(input.draft.tree);
	if (!composition || composition.source === null) throw editError("INVALID_COMPOSITION", "agent.cordis.yml must be UTF-8 text");
	return { path: "agent.cordis.yml", content: editText(composition.source, edit, options) };
}

function semanticRows(tree, options) {
	const composition = compositionFile(tree);
	if (!composition || composition.source === null) return new Map();
	const inspection = inspectText(composition.source, options);
	if (inspection.document.errors.length) return new Map();
	const publicRows = new Map(inspection.categories.flatMap((category) => category.rows.map((row) => [row.id, row])));
	return new Map(inspection.rowNodes.flatMap((node) => {
		const id = scalarValue(node, "id");
		const row = publicRows.get(id);
		return row ? [[id, { ...row, source: composition.source.slice(node.range[0], node.range[1]) }]] : [];
	}));
}

function fileChangeCategory(path) {
	return path.startsWith("skills/") ? "Skills" : "Other";
}

export function summarizeSemanticDiff(input, options = {}) {
	const beforeRows = semanticRows(input.source.tree, options);
	const afterRows = semanticRows(input.draft.tree, options);
	const changes = [];
	for (const id of [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort()) {
		const before = beforeRows.get(id);
		const after = afterRows.get(id);
		if (!before || !after) {
			changes.push({ category: (after ?? before)?.category ?? "Other", kind: before ? "row.removed" : "row.added", rowId: id });
			continue;
		}
		if (JSON.stringify(before.state) !== JSON.stringify(after.state)) {
			changes.push({ category: after.category, kind: "state.changed", rowId: id, before: before.state, after: after.state });
		}
		if (before.inspection === "verified" && after.inspection === "verified") {
			const beforeFields = new Map(before.fields.map((field) => [field.path, field.value]));
			for (const field of after.fields) {
				if (beforeFields.has(field.path) && !Object.is(beforeFields.get(field.path), field.value)) {
					changes.push({ category: after.category, kind: "field.changed", rowId: id, path: field.path, before: beforeFields.get(field.path), after: field.value });
				}
			}
		} else if (before.source !== after.source && JSON.stringify(before.state) === JSON.stringify(after.state)) {
			changes.push({ category: after.category, kind: "row.changed", rowId: id, inspection: "uninspected" });
		}
	}
	const sourceFiles = new Map(input.source.tree.map((file) => [file.path, file.content]));
	const draftFiles = new Map(input.draft.tree.map((file) => [file.path, file.content]));
	for (const path of [...new Set([...sourceFiles.keys(), ...draftFiles.keys()])].sort()) {
		if (path === "agent.cordis.yml" || sourceFiles.get(path) === draftFiles.get(path)) continue;
		const kind = !sourceFiles.has(path) ? "file.added" : !draftFiles.has(path) ? "file.removed" : "file.changed";
		changes.push({ category: fileChangeCategory(path), kind, path });
	}
	return { changes };
}

function textFiles(tree) {
	const files = new Map();
	for (const file of tree) {
		try { files.set(file.path, decodePresetText(file)); } catch { files.set(file.path, null); }
	}
	return files;
}

function linesOf(text) {
	if (text === "") return [];
	return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

export function createRawDiff(input) {
	const before = textFiles(input.source.tree);
	const after = textFiles(input.draft.tree);
	const chunks = [];
	for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
		if (before.get(path) === after.get(path) && before.has(path) === after.has(path)) continue;
		chunks.push(`--- ${before.has(path) ? `a/${path}` : "/dev/null"}`);
		chunks.push(`+++ ${after.has(path) ? `b/${path}` : "/dev/null"}`);
		if (before.get(path) === null || after.get(path) === null) {
			chunks.push("Binary files differ");
			continue;
		}
		const removed = before.has(path) ? linesOf(before.get(path)) : [];
		const added = after.has(path) ? linesOf(after.get(path)) : [];
		chunks.push(`@@ -${removed.length ? 1 : 0},${removed.length} +${added.length ? 1 : 0},${added.length} @@`);
		chunks.push(...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`));
	}
	return chunks.length ? `${chunks.join("\n")}\n` : "";
}

export function createSemanticAdapters(options = {}) {
	return Object.freeze({
		inspection: (input) => inspectPreset(input, options),
		edit: (input, command) => editPreset(input, command, options),
		preflight: preflightPreset,
		semanticDiff: (input) => summarizeSemanticDiff(input, options),
		rawDiff: createRawDiff,
	});
}
