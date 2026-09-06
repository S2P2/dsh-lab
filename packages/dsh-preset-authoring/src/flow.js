import { createPresetDraftService } from "./domain.js";
import { createLocalGitAdapter } from "./git.js";
import { createHostAdapters } from "./host.js";
import { createSemanticAdapters } from "./semantics.js";
import { createPresetTree, fingerprintPresetTree } from "./tree.js";
import { createPresetAuthoringController } from "./controller.js";

function gitError(result) {
	return Object.assign(new Error(result.diagnostic?.message ?? `Git ${result.operation} failed`), {
		code: "GIT_DEGRADED",
		git: result,
	});
}

function attachRecovery(error, recovery, fallbackRecovery, recoveryState) {
	if (error && (typeof error === "object" || typeof error === "function")) {
		Object.defineProperties(error, {
			recovery: { value: recovery, enumerable: true },
			fallbackRecovery: { value: fallbackRecovery, enumerable: true },
			recoveryState: { value: recoveryState, enumerable: true },
		});
	}
	return error;
}

async function sourceMatches(host, input) {
	try {
		const restored = await host.readTarget(input.target.id);
		return fingerprintPresetTree(createPresetTree(restored.files)) === input.source.fingerprint;
	} catch {
		return false;
	}
}

async function recoverCandidate({ locked, host, pathspec, head, input }) {
	let recovery = await locked.restoreTarget(pathspec, head.revision, `Recover validation for ${input.target.id}`);
	if (recovery.status !== "degraded" && await sourceMatches(host, input)) return {};
	if (recovery.status !== "degraded") recovery = { status: "degraded" };
	try {
		await host.restoreTarget(input.target.id, input.source.tree);
		if (!await sourceMatches(host, input)) throw new Error("fallback recovery did not restore the captured source");
		return { recovery, fallbackRecovery: { status: "ready" }, recoveryState: "recovered-via-fallback" };
	} catch {
		return { recovery, fallbackRecovery: { status: "failed" }, recoveryState: "unrecovered" };
	}
}

/** Compose the complete Host-owned preset authoring flow. */
export function createHostPresetAuthoring(agentPresets, options = {}) {
	const host = options.host ?? createHostAdapters(agentPresets);
	const git = options.git ?? createLocalGitAdapter({ root: host.editableRoot(), ...options.gitOptions });
	const semantics = createSemanticAdapters(options.semantics);
	const adapters = {
		...host,
		...semantics,
		async mount(input) {
			return git.withRootLock(async (locked) => {
				const pathspec = await host.gitTarget(input.target.id);
				const baseline = await locked.ensureTargetBaseline(pathspec);
				if (baseline.status === "degraded") throw gitError(baseline);
				const head = await locked.recordHead();
				if (head.status === "degraded") throw gitError(head);
				let value;
				let validationError;
				try {
					await host.materializeTarget(input.target.id, input.draft.tree);
					value = await host.validateMaterializedTarget(input.target.id);
				} catch (error) {
					validationError = error;
				}
				const degradation = await recoverCandidate({ locked, host, pathspec, head, input });
				if (degradation.recoveryState === "unrecovered") {
					const fatal = validationError ?? Object.assign(new Error("validation candidate could not be removed"), { code: "PRESET_VALIDATION_UNRECOVERED" });
					fatal.code = "PRESET_VALIDATION_UNRECOVERED";
					throw attachRecovery(fatal, degradation.recovery, degradation.fallbackRecovery, degradation.recoveryState);
				}
				if (validationError) {
					if (degradation.recoveryState) attachRecovery(validationError, degradation.recovery, degradation.fallbackRecovery, degradation.recoveryState);
					throw validationError;
				}
				return { ...value, ...degradation };
			});
		},
		async apply(input) {
			return git.withRootLock(async (locked) => {
				const pathspec = await host.gitTarget(input.target.id);
				const baseline = await locked.ensureTargetBaseline(pathspec);
				if (baseline.status === "degraded") throw gitError(baseline);
				const head = await locked.recordHead();
				if (head.status === "degraded") throw gitError(head);
				const current = await host.readTarget(input.target.id);
				const currentFingerprint = fingerprintPresetTree(createPresetTree(current.files));
				if (currentFingerprint !== input.source.fingerprint) {
					throw Object.assign(new Error("preset draft is stale"), { code: "STALE_PRESET_DRAFT" });
				}
				try {
					await host.materializeTarget(input.target.id, input.draft.tree);
					const validation = await host.validateMaterializedTarget(input.target.id);
					const committed = await locked.commitTarget(pathspec, `Apply preset ${input.target.id}`);
					if (committed.status === "degraded") throw gitError(committed);
					return { saved: true, revision: committed.revision, standingKey: validation.standingKey };
				} catch (error) {
					const degradation = await recoverCandidate({ locked, host, pathspec, head, input });
					if (degradation.recoveryState) attachRecovery(error, degradation.recovery, degradation.fallbackRecovery, degradation.recoveryState);
					if (degradation.recoveryState === "unrecovered" && error && typeof error === "object") error.code = "PRESET_APPLY_UNRECOVERED";
					throw error;
				}
			});
		},
		async history(input) {
			const result = await git.listHistory(await host.gitTarget(input.target.id));
			if (result.status === "degraded") throw gitError(result);
			return result.entries;
		},
		async restoreHistory(input, revision) {
			const result = await git.restoreTarget(await host.gitTarget(input.target.id), revision, `Restore preset ${input.target.id}`);
			if (result.status === "degraded") throw gitError(result);
			return result;
		},
	};
	const service = createPresetDraftService(adapters);
	const controller = createPresetAuthoringController({ service, host, testHandoff: options.testHandoff });
	return Object.freeze({ service, controller, host, git });
}
