import { createPresetDraftService } from "./domain.js";
import { createPresetAuthoringController } from "./controller.js";
import { createHostPresetAuthoring } from "./flow.js";
import { createPresetAuthoringRoute, PRESET_AUTHORING_API_PATH } from "./route.js";

export {
	PRESET_DRAFT_COMMANDS,
	createPresetDraftService,
} from "./domain.js";
export {
	SEMANTIC_CATEGORIES,
	createRawDiff,
	createSemanticAdapters,
	editPreset,
	inspectPreset,
	preflightPreset,
	summarizeSemanticDiff,
} from "./semantics.js";
export {
	assertSafePresetPath,
	createPresetTree,
	decodePresetFile,
	decodePresetText,
	fingerprintPresetTree,
} from "./tree.js";
export { createLocalGitAdapter } from "./git.js";
export { createPresetAuthoringController } from "./controller.js";
export { createHostPresetAuthoring } from "./flow.js";
export { createPresetAuthoringRoute, PRESET_AUTHORING_API_PATH } from "./route.js";
export {
	createHostAdapters,
	materializePresetDirectory,
	readPresetDirectory,
	restorePresetDirectory,
} from "./host.js";

export const name = "dsh-preset-authoring";
export const inject = ["agentPresets"];
export const serviceName = "presetAuthoringDrafts";

/** Provide one complete shared Host flow; temporary Cordis bridges inject this service. */
export function apply(ctx, config = {}) {
	const flow = config.adapters
		? (() => {
			const host = config.adapters;
			const service = createPresetDraftService(host);
			return { host, service, controller: createPresetAuthoringController({ service, host }) };
		})()
		: createHostPresetAuthoring(ctx.agentPresets, config);
	const dispose = ctx.provide(serviceName, flow.service);
	if (typeof ctx.inject === "function") {
		ctx.inject(["webServer"], (host) => {
			const resolveSessionPreset = config.resolveSessionPreset ?? (async ({ sessionId }) => {
				const sessionController = typeof ctx.get === "function" ? ctx.get("sessionController") : undefined;
				if (typeof sessionId !== "string" || typeof sessionController?.inspect !== "function") return undefined;
				return (await sessionController.inspect(sessionId)).meta?.agentPreset;
			});
			host.effect(() => host.webServer.register({
				kind: "exact",
				path: PRESET_AUTHORING_API_PATH,
				handler: createPresetAuthoringRoute(flow.controller, { resolveSessionPreset }),
			}), "dsh-preset-authoring: panel API route");
		});
	}
	return dispose;
}
