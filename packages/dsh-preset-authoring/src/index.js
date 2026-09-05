import { createPresetDraftService } from "./domain.js";
import { createHostAdapters } from "./host.js";

export {
	PRESET_DRAFT_COMMANDS,
	createPresetDraftService,
} from "./domain.js";
export {
	assertSafePresetPath,
	createPresetTree,
	decodePresetFile,
	decodePresetText,
	fingerprintPresetTree,
} from "./tree.js";
export { createLocalGitAdapter } from "./git.js";
export {
	createHostAdapters,
	materializePresetDirectory,
	readPresetDirectory,
	restorePresetDirectory,
} from "./host.js";

export const name = "dsh-preset-authoring";
export const inject = ["agentPresets"];
export const serviceName = "presetAuthoringDrafts";

/** Provide the shared draft service from the Host plane. */
export function apply(ctx, config = {}) {
	const adapters = config.adapters ?? (ctx.agentPresets ? createHostAdapters(ctx.agentPresets) : undefined);
	const service = createPresetDraftService(adapters);
	return ctx.provide(serviceName, service);
}
