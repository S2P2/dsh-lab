import { createPresetDraftService } from "./domain.js";

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

export const name = "dsh-preset-authoring";
export const serviceName = "presetAuthoringDrafts";

/** Provide the shared draft service from the Host plane. */
export function apply(ctx, config = {}) {
	const service = createPresetDraftService(config.adapters);
	return ctx.provide(serviceName, service);
}
