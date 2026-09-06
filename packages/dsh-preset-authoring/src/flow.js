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

/** Compose the complete Host-owned preset authoring flow. */
export function createHostPresetAuthoring(agentPresets, options = {}) {
	const host = options.host ?? createHostAdapters(agentPresets);
	const git = options.git ?? createLocalGitAdapter({ root: host.editableRoot(), ...options.gitOptions });
	const semantics = createSemanticAdapters(options.semantics);
	const adapters = {
		...host,
		...semantics,
		async apply(input) {
			return git.withRootLock(async (locked) => {
				const baseline = await locked.ensureBaseline();
				if (baseline.status === "degraded") throw gitError(baseline);
				const head = await locked.recordHead();
				if (head.status === "degraded") throw gitError(head);
				const current = await host.readTarget(input.target.id);
				const currentFingerprint = fingerprintPresetTree(createPresetTree(current.files));
				if (currentFingerprint !== input.source.fingerprint) {
					throw Object.assign(new Error("preset draft is stale"), { code: "STALE_PRESET_DRAFT" });
				}
				const pathspec = await host.gitTarget(input.target.id);
				await host.materializeTarget(input.target.id, input.draft.tree);
				try {
					const validation = await host.validateMaterializedTarget(input.target.id);
					const committed = await locked.commitTarget(pathspec, `Apply preset ${input.target.id}`);
					if (committed.status === "degraded") throw gitError(committed);
					return { saved: true, revision: committed.revision, standingKey: validation.standingKey };
				} catch (error) {
					const restored = await locked.restoreTarget(pathspec, head.revision, `Recover failed Apply for ${input.target.id}`);
					if (restored.status === "degraded" && error && (typeof error === "object" || typeof error === "function")) {
						Object.defineProperty(error, "recovery", { value: restored, enumerable: true });
					}
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
