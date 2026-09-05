import {
	assertSafePresetPath,
	createPresetTree,
	decodePresetFile,
	fingerprintPresetTree,
} from "./tree.js";

export const PRESET_DRAFT_COMMANDS = Object.freeze({
	SET_SESSION: "session.set",
	OPEN_TARGET: "target.open",
	PUT_FILE: "draft.putFile",
	DELETE_FILE: "draft.deleteFile",
	CHECK_SOURCE: "source.check",
	REFRESH_ANALYSIS: "draft.refreshAnalysis",
	VALIDATE_MOUNT: "draft.validateMount",
	APPLY: "draft.apply",
	LOAD_HISTORY: "history.load",
});

const CHANNELS = ["semanticDiff", "rawDiff", "preflight", "mount", "apply", "history"];

function slot(status = "idle", value = null, diagnostic = null) {
	return Object.freeze({ status, value, diagnostic });
}

function diagnosticOf(error) {
	return Object.freeze({
		message: error instanceof Error ? error.message : String(error),
		...(error && typeof error === "object" && "code" in error ? { code: error.code } : {}),
	});
}

function unavailable(name) {
	return slot("unavailable", null, Object.freeze({ message: `${name} adapter is not configured` }));
}

function cleanChannels(adapters) {
	return Object.fromEntries(CHANNELS.map((name) => [name, adapters[name] ? slot() : unavailable(name)]));
}

function invalidatedDraftChannels(adapters) {
	return Object.fromEntries(
		["semanticDiff", "rawDiff", "preflight", "mount", "apply"]
			.map((name) => [name, adapters[name] ? slot() : unavailable(name)]),
	);
}

function freezeTarget(target) {
	if (target === null || typeof target !== "object") throw new TypeError("target adapter returned no target");
	if (typeof target.id !== "string" || target.id.length === 0) throw new TypeError("target id must be a non-empty string");
	return Object.freeze({
		id: target.id,
		editable: target.editable === true,
		...(target.revision === undefined ? {} : { revision: target.revision }),
	});
}

function adapterInput(state) {
	return Object.freeze({
		sessionPresetId: state.sessionPresetId,
		target: state.target,
		source: Object.freeze({ fingerprint: state.sourceFingerprint, tree: state.sourceTree }),
		draft: Object.freeze({ fingerprint: state.draftFingerprint, tree: state.draftTree }),
	});
}

/**
 * One Host-owned source of shared preset draft state.
 *
 * Adapters are deliberately narrow. `readTarget` is the only required seam;
 * semanticDiff, rawDiff, preflight, mount, apply, and history may arrive in
 * later slices without changing the service or snapshot shape.
 */
export function createPresetDraftService(adapters = {}) {
	let state = {
		revision: 0,
		sessionPresetId: null,
		target: null,
		sourceTree: null,
		sourceFingerprint: null,
		draftTree: null,
		draftFingerprint: null,
		stale: false,
		...cleanChannels(adapters),
	};
	const listeners = new Set();
	let queue = Promise.resolve();

	function snapshot() {
		return Object.freeze({
			revision: state.revision,
			sessionPresetId: state.sessionPresetId,
			target: state.target,
			source: state.sourceTree === null ? null : Object.freeze({
				fingerprint: state.sourceFingerprint,
				tree: state.sourceTree,
			}),
			draft: state.draftTree === null ? null : Object.freeze({
				fingerprint: state.draftFingerprint,
				tree: state.draftTree,
			}),
			stale: state.stale,
			semanticDiff: state.semanticDiff,
			rawDiff: state.rawDiff,
			preflight: state.preflight,
			mount: state.mount,
			apply: state.apply,
			history: state.history,
		});
	}

	function publish(patch) {
		state = { ...state, ...patch, revision: state.revision + 1 };
		const next = snapshot();
		for (const listener of listeners) listener(next);
		return next;
	}

	function requireDraft() {
		if (state.target === null || state.draftTree === null) throw new Error("no preset target is open");
	}

	function requireEditableDraft() {
		requireDraft();
		if (!state.target.editable) {
			const error = Object.assign(new Error("preset target is read-only"), { code: "READ_ONLY_PRESET_TARGET" });
			throw error;
		}
	}

	async function readTarget(targetId) {
		if (typeof adapters.readTarget !== "function") throw new Error("readTarget adapter is not configured");
		const loaded = await adapters.readTarget(targetId);
		const target = freezeTarget({ ...loaded, id: loaded?.id ?? targetId });
		if (target.id !== targetId) throw new Error("target adapter returned a different target id");
		const tree = createPresetTree(loaded.files);
		return { target, tree, fingerprint: fingerprintPresetTree(tree) };
	}

	async function checkSource() {
		requireDraft();
		const current = await readTarget(state.target.id);
		const stale = current.fingerprint !== state.sourceFingerprint;
		publish({ stale });
		return stale;
	}

	async function runAdapter(channel) {
		requireDraft();
		const adapter = adapters[channel];
		if (typeof adapter !== "function") {
			publish({ [channel]: unavailable(channel) });
			return snapshot();
		}
		publish({ [channel]: slot("running") });
		try {
			const value = await adapter(adapterInput(state));
			return publish({ [channel]: slot("ready", value) });
		} catch (error) {
			publish({ [channel]: slot("failed", null, diagnosticOf(error)) });
			throw error;
		}
	}

	async function executeCommand(command) {
		if (command === null || typeof command !== "object") throw new TypeError("command must be an object");
		switch (command.type) {
			case PRESET_DRAFT_COMMANDS.SET_SESSION:
				return publish({ sessionPresetId: command.presetId ?? null });
			case PRESET_DRAFT_COMMANDS.OPEN_TARGET: {
				if (typeof command.targetId !== "string" || command.targetId.length === 0) {
					throw new TypeError("targetId must be a non-empty string");
				}
				const loaded = await readTarget(command.targetId);
				return publish({
					target: loaded.target,
					sourceTree: loaded.tree,
					sourceFingerprint: loaded.fingerprint,
					draftTree: loaded.tree,
					draftFingerprint: loaded.fingerprint,
					stale: false,
					...cleanChannels(adapters),
				});
			}
			case PRESET_DRAFT_COMMANDS.PUT_FILE: {
				requireEditableDraft();
				const path = assertSafePresetPath(command.path);
				const files = state.draftTree
					.filter((file) => file.path !== path)
					.map((file) => ({ path: file.path, content: decodePresetFile(file) }));
				files.push({ path, content: command.content });
				const tree = createPresetTree(files);
				return publish({
					draftTree: tree,
					draftFingerprint: fingerprintPresetTree(tree),
					...invalidatedDraftChannels(adapters),
				});
			}
			case PRESET_DRAFT_COMMANDS.DELETE_FILE: {
				requireEditableDraft();
				const path = assertSafePresetPath(command.path);
				if (!state.draftTree.some((file) => file.path === path)) return snapshot();
				const tree = createPresetTree(state.draftTree
					.filter((file) => file.path !== path)
					.map((file) => ({ path: file.path, content: decodePresetFile(file) })));
				return publish({
					draftTree: tree,
					draftFingerprint: fingerprintPresetTree(tree),
					...invalidatedDraftChannels(adapters),
				});
			}
			case PRESET_DRAFT_COMMANDS.CHECK_SOURCE:
				await checkSource();
				return snapshot();
			case PRESET_DRAFT_COMMANDS.REFRESH_ANALYSIS:
				for (const channel of ["semanticDiff", "rawDiff", "preflight"]) await runAdapter(channel);
				return snapshot();
			case PRESET_DRAFT_COMMANDS.VALIDATE_MOUNT:
				if (await checkSource()) {
					const error = Object.assign(new Error("preset draft is stale"), { code: "STALE_PRESET_DRAFT" });
					publish({ mount: slot("blocked", null, diagnosticOf(error)) });
					throw error;
				}
				return runAdapter("mount");
			case PRESET_DRAFT_COMMANDS.APPLY:
				requireEditableDraft();
				if (await checkSource()) {
					const error = Object.assign(new Error("preset draft is stale"), { code: "STALE_PRESET_DRAFT" });
					publish({ apply: slot("blocked", null, diagnosticOf(error)) });
					throw error;
				}
				return runAdapter("apply");
			case PRESET_DRAFT_COMMANDS.LOAD_HISTORY:
				return runAdapter("history");
			default:
				throw new TypeError(`unknown preset draft command: ${JSON.stringify(command.type)}`);
		}
	}

	function dispatch(command) {
		const result = queue.then(() => executeCommand(command));
		queue = result.catch(() => {});
		return result;
	}

	return Object.freeze({
		dispatch,
		getSnapshot: snapshot,
		subscribe(listener) {
			if (typeof listener !== "function") throw new TypeError("listener must be a function");
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	});
}
