import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertSafePresetPath,
	createPresetTree,
	decodePresetFile,
	fingerprintPresetTree,
} from "../src/index.js";

test("whole-tree fingerprints are canonical and include every file byte", () => {
	const first = createPresetTree([
		{ path: "skills/review/SKILL.md", content: "review" },
		{ path: "agent.cordis.yml", content: "name: demo\n" },
	]);
	const reordered = createPresetTree([
		{ path: "agent.cordis.yml", content: new TextEncoder().encode("name: demo\n") },
		{ path: "skills/review/SKILL.md", content: "review" },
	]);
	const changedAsset = createPresetTree([
		{ path: "agent.cordis.yml", content: "name: demo\n" },
		{ path: "skills/review/SKILL.md", content: "changed" },
	]);

	assert.deepEqual(first.map((file) => file.path), ["agent.cordis.yml", "skills/review/SKILL.md"]);
	assert.equal(fingerprintPresetTree(first), fingerprintPresetTree(reordered));
	assert.notEqual(fingerprintPresetTree(first), fingerprintPresetTree(changedAsset));
});

test("fingerprint framing distinguishes path/content boundaries", () => {
	const left = createPresetTree([{ path: "a", content: "bc" }]);
	const right = createPresetTree([{ path: "ab", content: "c" }]);
	assert.notEqual(fingerprintPresetTree(left), fingerprintPresetTree(right));
});

test("trees preserve binary preset assets", () => {
	const tree = createPresetTree([{ path: "assets/icon.bin", content: new Uint8Array([0, 255, 1]) }]);
	assert.deepEqual(decodePresetFile(tree[0]), new Uint8Array([0, 255, 1]));
});

test("preset paths cannot escape or ambiguously address the target directory", () => {
	for (const path of ["", "/agent.cordis.yml", "../secret", "skills/../secret", "a//b", "a\\b", "./a", "a/.", "a/\0b"]) {
		assert.throws(() => assertSafePresetPath(path), /preset file path/);
	}
	assert.equal(assertSafePresetPath("skills/review/SKILL.md"), "skills/review/SKILL.md");
	assert.throws(
		() => createPresetTree([{ path: "a", content: "1" }, { path: "a", content: "2" }]),
		/duplicate preset file path/,
	);
});
