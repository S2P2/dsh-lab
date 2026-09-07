import { createHash } from "node:crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function assertSafePresetPath(value) {
	if (typeof value !== "string" || value.length === 0) {
		throw new TypeError("preset file path must be a non-empty string");
	}
	if (value.includes("\0") || value.includes("\\") || value.startsWith("/")) {
		throw new TypeError(`unsafe preset file path: ${JSON.stringify(value)}`);
	}
	const segments = value.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
		throw new TypeError(`unsafe preset file path: ${JSON.stringify(value)}`);
	}
	return value;
}

function bytesOf(content) {
	if (typeof content === "string") return encoder.encode(content);
	if (content instanceof Uint8Array) return new Uint8Array(content);
	throw new TypeError("preset file content must be a string or Uint8Array");
}

function comparePaths(left, right) {
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

/** Create the canonical, JSON-safe representation of a complete preset directory. */
export function createPresetTree(files) {
	if (!Array.isArray(files)) throw new TypeError("preset tree files must be an array");
	const seen = new Set();
	const canonical = files.map((file) => {
		if (file === null || typeof file !== "object") throw new TypeError("preset file must be an object");
		const path = assertSafePresetPath(file.path);
		if (seen.has(path)) throw new TypeError(`duplicate preset file path: ${JSON.stringify(path)}`);
		seen.add(path);
		return Object.freeze({ path, content: Buffer.from(bytesOf(file.content)).toString("base64") });
	});
	canonical.sort(comparePaths);
	return Object.freeze(canonical);
}

export function decodePresetFile(file) {
	assertSafePresetPath(file?.path);
	if (typeof file?.content !== "string") throw new TypeError("canonical preset file content must be base64");
	return new Uint8Array(Buffer.from(file.content, "base64"));
}

export function decodePresetText(file) {
	return decoder.decode(decodePresetFile(file));
}

/** Fingerprint names, boundaries, and bytes for the entire canonical tree. */
export function fingerprintPresetTree(tree) {
	const canonical = createPresetTree(tree.map((file) => ({ path: file.path, content: decodePresetFile(file) })));
	const hash = createHash("sha256");
	hash.update("dsh-preset-tree\0v1\0");
	for (const file of canonical) {
		const path = encoder.encode(file.path);
		const content = decodePresetFile(file);
		const lengths = Buffer.alloc(12);
		lengths.writeUInt32BE(path.byteLength, 0);
		lengths.writeBigUInt64BE(BigInt(content.byteLength), 4);
		hash.update(lengths);
		hash.update(path);
		hash.update(content);
	}
	return `sha256:${hash.digest("hex")}`;
}
