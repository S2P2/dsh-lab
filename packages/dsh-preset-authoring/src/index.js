import { createPresetDraftService } from "./domain.js";
import { createPresetAuthoringController } from "./controller.js";
import { createHostPresetAuthoring } from "./flow.js";
import { createPresetStudioPresenter } from "./studio-presenter.js";
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
export { PRESET_PANEL_COMMANDS, createPresetPanelPresenter } from "./presenter.js";
export { PRESET_COMPOSITION_PATH, createPresetStudioPresenter } from "./studio-presenter.js";
export {
	categorizeRow,
	flattenRows,
	isJsExpr,
	parsePresetYaml,
	parseYamlValue,
	stringifyPresetYaml,
	stringifyYamlValue,
	toPresetRows,
} from "./preset-yaml.js";
export {
	editorFromRows,
	moduleShortName,
	mutateEditor,
	removeEditorRow,
	rowsFromEditor,
} from "./preset-editor-model.js";
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

/** Resolve the optional plugin-inventory service without requiring it to exist. */
function resolvePluginInventory(ctx) {
	try {
		return typeof ctx?.get === "function" ? ctx.get("pluginInventory") : undefined;
	} catch {
		return undefined;
	}
}

/** Provide one complete shared Host flow; temporary Cordis bridges inject this service. */
export function apply(ctx, config = {}) {
	const flow = config.adapters
		? (() => {
			const host = config.adapters;
			const service = createPresetDraftService(host);
			return { host, service, controller: createPresetAuthoringController({ service, host, presenter: config.presenter ?? createPresetStudioPresenter() }) };
		})()
		: createHostPresetAuthoring(ctx.agentPresets, {
			...config,
			pluginInventory: config.pluginInventory ?? resolvePluginInventory(ctx),
		});
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
