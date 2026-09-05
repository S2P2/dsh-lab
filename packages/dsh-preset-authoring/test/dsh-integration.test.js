import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import AgentPresets from "@deepseek-ai/dsh-agent-presets";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
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
		source: { tree: source.files },
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
