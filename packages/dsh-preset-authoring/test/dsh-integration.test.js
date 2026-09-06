import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import AgentPresets from "@deepseek-ai/dsh-agent-presets";
import DynamicCordisRunner from "@deepseek-ai/dsh-cordis-host-runner";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import * as ToolCordis from "@deepseek-ai/dsh-tool-cordis";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import * as PresetAuthoring from "../src/index.js";
import { createHostAdapters, createPresetTree } from "../src/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const roots = [];

after(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function realRoster(id, composition, hostService) {
	const root = await mkdtemp(join(tmpdir(), "dsh-real-standing-key-"));
	roots.push(root);
	const directory = join(root, id);
	await mkdir(directory);
	await writeFile(join(directory, "agent.cordis.yml"), composition);
	const ctx = new Context();
	ctx.baseUrl = `${pathToFileURL(fixtures).href}/`;
	await ctx.plugin(Loader);
	await ctx.plugin(SessionProjectionRegistry);
	if (hostService) ctx.provide(hostService, { from: "host" });
	await ctx.plugin(AgentPresets, {
		default: id,
		roots: [{ path: root, trust: "user" }],
		includeShippedRoot: false,
		includeUserRoot: false,
	});
	return { adapters: createHostAdapters(ctx.agentPresets), ctx, root };
}

const row = (plugin, extra = "") => `- id: fixture\n  name: ${join(fixtures, plugin)}\n${extra}`;

async function validateCandidate(id, saved, candidate, hostService) {
	const { adapters } = await realRoster(id, saved, hostService);
	const source = await adapters.readTarget(id);
	return adapters.mount({
		target: { id },
		source: { tree: createPresetTree(source.files) },
		draft: { tree: createPresetTree([{ path: "agent.cordis.yml", content: candidate }]) },
	});
}

test("published DSH standingKeyFor accepts a valid candidate composition", async () => {
	const result = await validateCandidate("valid", row("valid-plugin.js"), row("valid-plugin.js"));
	assert.deepEqual(result.standingKey, { agentPreset: "valid" });
});

test("published DSH standingKeyFor preserves unresolved-package diagnostics", async () => {
	await assert.rejects(
		validateCandidate("unresolved", row("valid-plugin.js"), "- id: missing\n  name: definitely-not-a-real-dsh-package\n"),
		/failed to mount: row "missing" names a plugin that cannot be resolved: definitely-not-a-real-dsh-package/,
	);
});

test("published DSH standingKeyFor preserves invalid-config diagnostics", async () => {
	await assert.rejects(
		validateCandidate("invalid-config", row("valid-plugin.js"), row("config-plugin.js")),
		/requiredText/,
	);
});

test("published DSH standingKeyFor preserves waiting-row diagnostics", async () => {
	await assert.rejects(
		validateCandidate("waiting", row("valid-plugin.js"), row("waiting-plugin.js")),
		/waiting for fixtureMissingService/,
	);
});

test("published DSH standingKeyFor rejects a Service in the root realm", async () => {
	const candidate = row("service-plugin.js", "  config:\n    name: fixtureLeakedService\n");
	await assert.rejects(
		validateCandidate("wrong-realm", row("valid-plugin.js"), candidate),
		/process-global service\(s\) \[fixtureLeakedService\]/,
	);
});

test("published DSH standingKeyFor preserves Host Service collision failures", async () => {
	const candidate = row("service-plugin.js", "  config:\n    name: fixtureHostService\n");
	await assert.rejects(
		validateCandidate("host-collision", row("valid-plugin.js"), candidate, "fixtureHostService"),
		/fixtureHostService|service/i,
	);
});

test("temporary Cordis bridge applies and recovers an invalid custom-creator draft", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsh-cordis-draft-"));
	roots.push(root);
	const directory = join(root, "custom-creator");
	const source = fileURLToPath(new URL("../../../presets/custom-creator/", import.meta.url));
	await cp(source, directory, { recursive: true });
	const saved = await readFile(join(directory, "agent.cordis.yml"), "utf8");
	const savedSkill = await readFile(join(directory, "skills", "editing-cordis-compositions", "SKILL.md"), "utf8");

	const ctx = new Context();
	ctx.baseUrl = `${pathToFileURL(fixtures).href}/`;
	await ctx.plugin(Loader);
	await ctx.plugin(SessionProjectionRegistry);
	await ctx.plugin(AgentPresets, {
		default: "custom-creator",
		roots: [{ path: root, trust: "user" }],
		includeShippedRoot: false,
		includeUserRoot: false,
	});
	await ctx.plugin(SystemPrompt, {});
	await ctx.plugin(ToolRuntime, {});
	await ctx.plugin(DynamicCordisRunner, {});
	await ctx.plugin(PresetAuthoring);
	await ctx.plugin(ToolCordis);

	await ctx.presetAuthoringDrafts.dispatch({ type: "target.open", targetId: "custom-creator" });
	let state = ctx.presetAuthoringDrafts.getSnapshot();
	const guard = () => ({
		targetId: state.target.id,
		expectedRevision: state.revision,
		expectedSourceFingerprint: state.source.fingerprint,
		expectedDraftFingerprint: state.draft.fingerprint,
	});
	await ctx.presetAuthoringDrafts.dispatch({
		type: "draft.putFile",
		...guard(),
		path: "agent.cordis.yml",
		content: "- id: missing\n  name: definitely-not-a-real-dsh-package\n",
	});
	state = ctx.presetAuthoringDrafts.getSnapshot();

	const agent = { id: "integration-agent", ctx, steer() {}, inject() {} };
	const signal = new AbortController().signal;
	let sequence = 0;
	async function call(name, args) {
		const result = await ctx.tools.execute({
			callId: `cordis-integration-${++sequence}`,
			name,
			arguments: args,
			agent,
			signal,
		});
		assert.equal(result.isError, false, result.content?.map((block) => block.text).join("\n"));
		return result.value;
	}

	const host = `return {
		inject: ['presetAuthoringDrafts', 'tools'],
		apply(ctx) {
			harness.registerTool(ctx, harness.defineTool({
				name: 'preset_apply_candidate',
				description: 'Apply the exact currently shared preset draft.',
				parameters: {
					targetId: { type: 'string', required: true },
					expectedRevision: { type: 'integer', required: true },
					expectedSourceFingerprint: { type: 'string', required: true },
					expectedDraftFingerprint: { type: 'string', required: true }
				},
				output: {
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							message: { type: 'string', required: true },
							applyStatus: { type: 'string', required: true },
							candidatePreserved: { type: 'boolean', required: true }
						}
					},
					render(_args, value) {
						return [{ type: 'text', text: value.message }]
					}
				},
				async execute(args) {
					const drafts = ctx.presetAuthoringDrafts
					try {
						await drafts.dispatch({ type: 'draft.apply', ...args })
						throw new Error('invalid candidate unexpectedly applied')
					} catch (error) {
						const state = drafts.getSnapshot()
						return {
							message: error.message,
							applyStatus: state.apply.status,
							candidatePreserved: state.draft.fingerprint !== state.source.fingerprint
						}
					}
				}
			}))
		}
	}`;

	const defined = await call("cordis_define", {
		plugin: { kind: "new", idPrefix: "draft" },
		name: "Preset draft apply bridge",
		purpose: "Apply one exact shared preset draft through the Host service.",
		code: { host },
	});
	assert.equal(defined.hasHostHalf, true);
	assert.equal(defined.hasClientHalf, false);

	const running = await call("cordis_run", {
		pluginId: defined.pluginId,
		packageId: defined.packageId,
		mode: "run",
	});
	assert.equal(running.status, "running");

	const result = await call("preset_apply_candidate", guard());
	assert.match(result.message, /cannot be resolved|definitely-not-a-real-dsh-package/);
	assert.equal(result.applyStatus, "failed");
	assert.equal(result.candidatePreserved, true);
	assert.equal(await readFile(join(directory, "agent.cordis.yml"), "utf8"), saved);
	assert.equal(await readFile(join(directory, "skills", "editing-cordis-compositions", "SKILL.md"), "utf8"), savedSkill);

	await call("cordis_stop", { pluginId: defined.pluginId });
	assert.equal(ctx.tools.get("preset_apply_candidate"), undefined);
	const removed = await call("cordis_undefine", { pluginId: defined.pluginId });
	assert.equal(removed.wasRunning, false);
	assert.equal(ctx.dynamicCordisRunner.inventory().some((item) => item.pluginId === defined.pluginId), false);
});
