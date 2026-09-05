import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import { createLocalGitAdapter } from "../src/index.js";

const exec = promisify(execFile);
const roots = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "dsh-preset-git-"));
	roots.push(root);
	await mkdir(join(root, "alpha"), { recursive: true });
	await mkdir(join(root, "beta"), { recursive: true });
	await writeFile(join(root, "alpha", "agent.cordis.yml"), "version: one\n");
	await writeFile(join(root, "beta", "agent.cordis.yml"), "beta: one\n");
	await writeFile(join(root, "notes.txt"), "baseline notes\n");
	return root;
}

async function git(root, ...args) {
	const { stdout } = await exec("git", args, { cwd: root, encoding: "utf8" });
	return stdout.trim();
}

test("initializes a local-only repository with a committed complete baseline", async () => {
	const root = await fixture();
	const adapter = createLocalGitAdapter({ root });

	const result = await adapter.ensureBaseline();

	assert.equal(result.status, "ready");
	assert.match(result.revision, /^[0-9a-f]{40}$/);
	assert.deepEqual((await git(root, "remote")).split("\n").filter(Boolean), []);
	assert.equal(await git(root, "status", "--porcelain"), "");
	assert.deepEqual(
		(await git(root, "ls-tree", "-r", "--name-only", "HEAD")).split("\n"),
		["alpha/agent.cordis.yml", "beta/agent.cordis.yml", "notes.txt"],
	);
});

test("commits only the selected target while preserving unrelated working and index state", async () => {
	const root = await fixture();
	const adapter = createLocalGitAdapter({ root });
	await adapter.ensureBaseline();
	await writeFile(join(root, "alpha", "agent.cordis.yml"), "version: two\n");
	await writeFile(join(root, "beta", "agent.cordis.yml"), "beta: staged\n");
	await git(root, "add", "--", "beta/agent.cordis.yml");
	await writeFile(join(root, "notes.txt"), "dirty notes\n");
	await writeFile(join(root, "outside.txt"), "untracked\n");

	const result = await adapter.commitTarget("alpha", "Apply alpha");

	assert.equal(result.status, "ready");
	assert.deepEqual((await git(root, "show", "--format=", "--name-only", "HEAD")).split("\n"), ["alpha/agent.cordis.yml"]);
	assert.equal(await git(root, "diff", "--cached", "--name-only"), "beta/agent.cordis.yml");
	assert.match(await git(root, "status", "--porcelain"), /^M  beta\/agent\.cordis\.yml$/m);
	assert.match(await git(root, "status", "--porcelain"), /^ M notes\.txt$/m);
	assert.match(await git(root, "status", "--porcelain"), /^\?\? outside\.txt$/m);
});

test("lists only history relevant to the selected target", async () => {
	const root = await fixture();
	const adapter = createLocalGitAdapter({ root });
	await adapter.ensureBaseline();
	await writeFile(join(root, "alpha", "agent.cordis.yml"), "version: two\n");
	const alphaCommit = await adapter.commitTarget("alpha", "Apply alpha");
	await writeFile(join(root, "beta", "agent.cordis.yml"), "beta: two\n");
	await adapter.commitTarget("beta", "Apply beta");

	const result = await adapter.listHistory("alpha");

	assert.equal(result.status, "ready");
	assert.equal(result.entries[0].revision, alphaCommit.revision);
	assert.equal(result.entries[0].subject, "Apply alpha");
	assert.equal(result.entries.some((entry) => entry.subject === "Apply beta"), false);
	assert.equal(result.entries.at(-1).subject, "Initialize editable presets");
});

test("restores the complete target at a revision and leaves unrelated state untouched", async () => {
	const root = await fixture();
	const adapter = createLocalGitAdapter({ root });
	const baseline = await adapter.ensureBaseline();
	await writeFile(join(root, "alpha", "agent.cordis.yml"), "version: two\n");
	await writeFile(join(root, "alpha", "skill.md"), "tracked later\n");
	await adapter.commitTarget("alpha", "Apply alpha v2");
	await writeFile(join(root, "alpha", "agent.cordis.yml"), "broken candidate\n");
	await writeFile(join(root, "alpha", "untracked.md"), "remove me\n");
	await writeFile(join(root, "beta", "agent.cordis.yml"), "beta: staged\n");
	await git(root, "add", "--", "beta/agent.cordis.yml");
	await writeFile(join(root, "notes.txt"), "dirty notes\n");
	await writeFile(join(root, "outside.txt"), "keep me\n");

	const result = await adapter.restoreTarget("alpha", baseline.revision, "Restore alpha baseline");

	assert.equal(result.status, "ready");
	assert.equal(await readFile(join(root, "alpha", "agent.cordis.yml"), "utf8"), "version: one\n");
	await assert.rejects(readFile(join(root, "alpha", "skill.md")), { code: "ENOENT" });
	await assert.rejects(readFile(join(root, "alpha", "untracked.md")), { code: "ENOENT" });
	assert.equal(await readFile(join(root, "outside.txt"), "utf8"), "keep me\n");
	assert.equal(await readFile(join(root, "notes.txt"), "utf8"), "dirty notes\n");
	assert.equal(await git(root, "diff", "--cached", "--name-only"), "beta/agent.cordis.yml");
	assert.deepEqual((await git(root, "show", "--format=", "--name-only", "HEAD")).split("\n"), [
		"alpha/agent.cordis.yml",
		"alpha/skill.md",
	]);
});

test("serializes root mutations and exposes one lock for an Apply transaction", async () => {
	const root = await fixture();
	const adapter = createLocalGitAdapter({ root });
	const secondAdapter = createLocalGitAdapter({ root });
	const order = [];

	await Promise.all([
		adapter.withRootLock(async (git) => {
			order.push("first:start");
			await git.ensureBaseline();
			await new Promise((resolve) => setTimeout(resolve, 25));
			order.push("first:end");
		}),
		secondAdapter.withRootLock(async (git) => {
			order.push("second");
			assert.equal((await git.recordHead()).status, "ready");
		}),
	]);

	assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("reports Git command failures as degraded history and recovery results", async () => {
	const root = await fixture();
	const adapter = createLocalGitAdapter({ root, gitBinary: "git-that-does-not-exist" });

	for (const result of [
		await adapter.ensureBaseline(),
		await adapter.recordHead(),
		await adapter.listHistory("alpha"),
		await adapter.restoreTarget("alpha", "deadbeef", "Restore alpha"),
	]) {
		assert.equal(result.status, "degraded");
		assert.equal(typeof result.diagnostic.message, "string");
		assert.equal(result.diagnostic.command.includes("git-that-does-not-exist"), true);
	}
});

test("rejects target pathspecs that could escape or select the repository root", async () => {
	const root = await fixture();
	const adapter = createLocalGitAdapter({ root });

	for (const target of ["", ".", "../outside", "/absolute", "alpha/../beta", ".git"]) {
		await assert.rejects(adapter.commitTarget(target, "unsafe"), /safe target directory/);
	}
});
