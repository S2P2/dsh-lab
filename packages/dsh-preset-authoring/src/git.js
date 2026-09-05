import { execFile } from "node:child_process";
import { lstat, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootQueues = new Map();
const DEFAULT_AUTHOR = Object.freeze({
	name: "DSH Preset Authoring",
	email: "preset-authoring@localhost",
});

function diagnosticOf(error, gitBinary, args) {
	return Object.freeze({
		message: error instanceof Error ? error.message : String(error),
		command: [gitBinary, ...args].join(" "),
		...(typeof error?.code === "string" ? { code: error.code } : {}),
		...(Number.isInteger(error?.code) ? { exitCode: error.code } : {}),
		...(typeof error?.stderr === "string" && error.stderr.trim()
			? { stderr: error.stderr.trim() }
			: {}),
	});
}

function degraded(operation, error, gitBinary, args = []) {
	return Object.freeze({
		status: "degraded",
		operation,
		diagnostic: diagnosticOf(error, gitBinary, args),
	});
}

function safeTarget(root, target) {
	if (
		typeof target !== "string"
		|| target.length === 0
		|| target === "."
		|| target === ".git"
		|| target.startsWith(".git/")
		|| target.includes("\\")
		|| isAbsolute(target)
		|| target.split("/").some((part) => part === "" || part === "." || part === "..")
	) {
		throw new TypeError("target must be a safe target directory beneath the editable preset root");
	}
	const absolute = resolve(root, target);
	const fromRoot = relative(root, absolute);
	if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
		throw new TypeError("target must be a safe target directory beneath the editable preset root");
	}
	return { pathspec: target, absolute };
}

function schedule(root, operation) {
	const previous = rootQueues.get(root) ?? Promise.resolve();
	const result = previous.then(operation, operation);
	const tail = result.catch(() => {});
	rootQueues.set(root, tail);
	tail.finally(() => {
		if (rootQueues.get(root) === tail) rootQueues.delete(root);
	});
	return result;
}

/**
 * Local-only Git history and recovery for one editable preset root.
 *
 * Results use `status: "degraded"` for Git/filesystem failures so callers can
 * keep preset loading and drafting available. Invalid target pathspecs remain
 * programmer errors and reject. `withRootLock` lets Apply hold the same root
 * lock across recording HEAD, writing its candidate, validation, and commit.
 */
export function createLocalGitAdapter(options) {
	if (!options || typeof options.root !== "string" || options.root.length === 0) {
		throw new TypeError("root must be a non-empty path");
	}
	const root = resolve(options.root);
	const gitBinary = options.gitBinary ?? "git";
	const author = { ...DEFAULT_AUTHOR, ...options.author };
	const execute = options.execFile ?? execFileAsync;

	async function command(args) {
		try {
			const result = await execute(gitBinary, args, {
				cwd: root,
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
				shell: false,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
			});
			return typeof result === "string" ? result : result.stdout ?? "";
		} catch (error) {
			error.gitArgs = args;
			throw error;
		}
	}

	async function hasGitDirectory() {
		try {
			await lstat(resolve(root, ".git"));
			return true;
		} catch (error) {
			if (error?.code === "ENOENT") return false;
			throw error;
		}
	}

	async function ensureBaseline() {
		const operation = "ensureBaseline";
		let lastArgs = [];
		try {
			if (!(await hasGitDirectory())) {
				lastArgs = ["init", "--quiet"];
				await command(lastArgs);
			}
			try {
				lastArgs = ["rev-parse", "--verify", "HEAD"];
				const revision = (await command(lastArgs)).trim();
				return Object.freeze({ status: "ready", revision, initialized: false });
			} catch {
				lastArgs = ["add", "-A", "--", "."];
				await command(lastArgs);
				lastArgs = [
					"-c", `user.name=${author.name}`,
					"-c", `user.email=${author.email}`,
					"commit", "--quiet", "--no-gpg-sign", "--allow-empty", "-m", "Initialize editable presets",
				];
				await command(lastArgs);
				lastArgs = ["rev-parse", "HEAD"];
				const revision = (await command(lastArgs)).trim();
				return Object.freeze({ status: "ready", revision, initialized: true });
			}
		} catch (error) {
			return degraded(operation, error, gitBinary, error.gitArgs ?? lastArgs);
		}
	}

	async function recordHead() {
		const baseline = await ensureBaseline();
		if (baseline.status === "degraded") return baseline;
		const args = ["rev-parse", "HEAD"];
		try {
			return Object.freeze({ status: "ready", revision: (await command(args)).trim() });
		} catch (error) {
			return degraded("recordHead", error, gitBinary, error.gitArgs ?? args);
		}
	}

	async function commitTarget(target, message = `Apply ${target}`) {
		const { pathspec } = safeTarget(root, target);
		const baseline = await ensureBaseline();
		if (baseline.status === "degraded") return baseline;
		let args = ["add", "-A", "--", pathspec];
		try {
			await command(args);
			args = ["diff", "--cached", "--name-only", "--", pathspec];
			if ((await command(args)).trim() === "") {
				return Object.freeze({ status: "ready", revision: baseline.revision, committed: false });
			}
			args = [
				"-c", `user.name=${author.name}`,
				"-c", `user.email=${author.email}`,
				"commit", "--quiet", "--no-gpg-sign", "--only", "-m", message, "--", pathspec,
			];
			await command(args);
			args = ["rev-parse", "HEAD"];
			const revision = (await command(args)).trim();
			return Object.freeze({ status: "ready", revision, committed: true });
		} catch (error) {
			return degraded("commitTarget", error, gitBinary, error.gitArgs ?? args);
		}
	}

	async function listHistory(target, { limit = 50 } = {}) {
		const { pathspec } = safeTarget(root, target);
		if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("history limit must be a positive integer");
		const baseline = await ensureBaseline();
		if (baseline.status === "degraded") return baseline;
		const args = ["log", `--max-count=${limit}`, "--format=%H%x00%cI%x00%s", "--", pathspec];
		try {
			const output = (await command(args)).trim();
			const entries = output === "" ? [] : output.split("\n").map((line) => {
				const [revision, committedAt, subject] = line.split("\0");
				return Object.freeze({ revision, committedAt, subject });
			});
			return Object.freeze({ status: "ready", entries: Object.freeze(entries) });
		} catch (error) {
			return degraded("listHistory", error, gitBinary, error.gitArgs ?? args);
		}
	}

	async function restoreTarget(target, revision, message = `Restore ${target} from ${revision}`) {
		const { pathspec, absolute } = safeTarget(root, target);
		if (typeof revision !== "string" || revision.length === 0) throw new TypeError("revision must be a non-empty string");
		const baseline = await ensureBaseline();
		if (baseline.status === "degraded") return baseline;
		let args = ["rev-parse", "--verify", `${revision}^{commit}`];
		try {
			const resolvedRevision = (await command(args)).trim();
			args = ["ls-tree", "-r", "--name-only", resolvedRevision, "--", pathspec];
			if ((await command(args)).trim() === "") throw new Error(`target ${pathspec} does not exist at revision ${revision}`);
			await rm(absolute, { recursive: true, force: true });
			args = ["restore", `--source=${resolvedRevision}`, "--staged", "--worktree", "--", pathspec];
			await command(args);
			return commitTarget(pathspec, message);
		} catch (error) {
			return degraded("restoreTarget", error, gitBinary, error.gitArgs ?? args);
		}
	}

	const unlocked = Object.freeze({ ensureBaseline, recordHead, commitTarget, listHistory, restoreTarget });
	return Object.freeze({
		root,
		withRootLock(operation) {
			if (typeof operation !== "function") throw new TypeError("operation must be a function");
			return schedule(root, () => operation(unlocked));
		},
		ensureBaseline: () => schedule(root, ensureBaseline),
		recordHead: () => schedule(root, recordHead),
		commitTarget: (target, message) => schedule(root, () => commitTarget(target, message)),
		listHistory: (target, options) => schedule(root, () => listHistory(target, options)),
		restoreTarget: (target, revision, message) => schedule(root, () => restoreTarget(target, revision, message)),
	});
}
