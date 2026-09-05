import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createPresetTree, decodePresetFile } from "./tree.js";

function expandRoot(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return resolve(path);
}

async function canonicalPath(path) {
	try {
		return await realpath(path);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		return resolve(path);
	}
}

function isContained(root, candidate) {
	const path = relative(root, candidate);
	return path !== "" && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
}

async function filesBelow(directory, current = directory) {
	const files = [];
	for (const entry of await readdir(current, { withFileTypes: true })) {
		const absolute = join(current, entry.name);
		if (entry.isDirectory()) {
			files.push(...await filesBelow(directory, absolute));
		} else if (entry.isFile()) {
			files.push({ path: relative(directory, absolute).split("\\").join("/"), content: await readFile(absolute) });
		} else {
			throw new Error(`preset directory contains unsupported entry: ${absolute}`);
		}
	}
	return files;
}

/** Read every regular file in a preset directory into one canonical tree. */
export async function readPresetDirectory(directory) {
	return createPresetTree(await filesBelow(resolve(directory)));
}

async function writeTree(directory, tree) {
	const canonical = createPresetTree(tree.map((file) => ({ path: file.path, content: decodePresetFile(file) })));
	for (const file of canonical) {
		const target = join(directory, ...file.path.split("/"));
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, decodePresetFile(file), { flag: "wx", mode: 0o600 });
	}
}

/** Replace a preset directory with exactly the supplied canonical tree. */
export async function materializePresetDirectory(directory, tree) {
	const target = resolve(directory);
	const nonce = randomUUID();
	const temporary = `${target}.materialize-${nonce}`;
	const backup = `${target}.backup-${nonce}`;
	let movedOriginal = false;
	await mkdir(dirname(target), { recursive: true });
	await mkdir(temporary, { mode: 0o700 });
	try {
		await writeTree(temporary, tree);
		try {
			await rename(target, backup);
			movedOriginal = true;
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
		try {
			await rename(temporary, target);
		} catch (error) {
			if (movedOriginal) await rename(backup, target);
			throw error;
		}
		if (movedOriginal) await rm(backup, { recursive: true, force: true });
	} catch (error) {
		await rm(temporary, { recursive: true, force: true });
		throw error;
	}
}

/** Restore a previously read complete preset tree. */
export async function restorePresetDirectory(directory, tree) {
	await materializePresetDirectory(directory, tree);
}

function publicTarget(preset, editable, files) {
	return {
		id: preset.id,
		editable,
		trust: preset.trust,
		...(preset.name === undefined ? {} : { name: preset.name }),
		...(preset.description === undefined ? {} : { description: preset.description }),
		...(preset.broken === undefined ? {} : { broken: preset.broken }),
		...(files === undefined ? {} : { files }),
	};
}

/** Build the thin Host adapter over DSH's authoritative agentPresets service. */
export function createHostAdapters(agentPresets) {
	if (!agentPresets || typeof agentPresets !== "object") throw new TypeError("agentPresets service is required");

	function firstUserRoot() {
		const root = agentPresets.roots?.find((candidate) => candidate.trust === "user");
		if (!root) throw new Error("agent-presets: no writable preset root is configured");
		return expandRoot(root.path);
	}

	async function editable(preset) {
		const [root, composition] = await Promise.all([
			canonicalPath(firstUserRoot()),
			canonicalPath(preset.path),
		]);
		return isContained(root, dirname(composition));
	}

	async function resolveRecord(id) {
		const preset = await agentPresets.resolve(id);
		if (!preset || preset.id !== id) throw new Error("agentPresets.resolve() returned a different target");
		return { preset, editable: await editable(preset) };
	}

	async function resolvedTarget(id, includeFiles = false) {
		const { preset, editable: canEdit } = await resolveRecord(id);
		return publicTarget(preset, canEdit, includeFiles ? await readPresetDirectory(dirname(preset.path)) : undefined);
	}

	async function editableTarget(id) {
		const target = await resolveRecord(id);
		if (!target.editable) {
			throw new Error(`preset "${id}" is not in the writable preset root`);
		}
		return target.preset;
	}

	return Object.freeze({
		async listTargets() {
			const presets = await agentPresets.list();
			return await Promise.all(presets.map((preset) => resolvedTarget(preset.id)));
		},
		async resolveTarget(id) {
			return await resolvedTarget(id, true);
		},
		async readTarget(id) {
			return await resolvedTarget(id, true);
		},
		async copyTarget(from, id, name) {
			await agentPresets.copy(from, id, name);
			return await resolvedTarget(id, true);
		},
		async materializeTarget(id, tree) {
			const target = await editableTarget(id);
			await materializePresetDirectory(dirname(target.path), tree);
		},
		async restoreTarget(id, tree) {
			const target = await editableTarget(id);
			await restorePresetDirectory(dirname(target.path), tree);
		},
		async mount(input) {
			const id = input?.target?.id;
			const target = await editableTarget(id);
			const directory = dirname(target.path);
			await materializePresetDirectory(directory, input.draft.tree);
			let validationError;
			try {
				const standingKey = await agentPresets.standingKeyFor(id);
				return { standingKey };
			} catch (error) {
				validationError = error;
				throw error;
			} finally {
				try {
					await restorePresetDirectory(directory, input.source.tree);
				} catch (restoreError) {
					if (validationError === undefined) throw restoreError;
					if (validationError && (typeof validationError === "object" || typeof validationError === "function")) {
						Object.defineProperty(validationError, "restoreError", { value: restoreError, enumerable: true });
					}
				}
			}
		},
	});
}
