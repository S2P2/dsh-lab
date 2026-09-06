import { diagnosticOf } from "./diagnostic.js";

export const PRESET_AUTHORING_API_PATH = "/dsh-preset-authoring/api";
const MAX_BODY_BYTES = 64 * 1024;

function send(response, status, payload, headers = {}) {
	response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
	response.end(JSON.stringify(payload));
}

function sameOrigin(request) {
	const origin = request.headers?.origin;
	if (!origin) return false;
	try {
		const url = new URL(origin);
		const protocol = request.socket?.encrypted ? "https:" : "http:";
		return url.host === request.headers.host && url.protocol === protocol;
	} catch { return false; }
}

function trustedLoopback(request) {
	const address = request.socket?.remoteAddress;
	return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function readJson(request) {
	let size = 0;
	const chunks = [];
	for await (const value of request) {
		const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
		size += chunk.length;
		if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request body exceeds 65536 bytes"), { code: "REQUEST_TOO_LARGE", status: 413 });
		chunks.push(chunk);
	}
	try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
	catch { throw Object.assign(new Error("request body must be valid JSON"), { code: "INVALID_JSON", status: 400 }); }
}

/** Exact, POST-only, same-origin Node HTTP route for the panel controller. */
export function createPresetAuthoringRoute(controller, options = {}) {
	return async function handler(request, response) {
		if (request.method !== "POST") return send(response, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "POST required" } }, { allow: "POST" });
		try {
			const body = await readJson(request);
			if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("request body must be an object"), { code: "INVALID_REQUEST", status: 400 });
			if (request.headers?.origin && !sameOrigin(request)) return send(response, 403, { ok: false, error: { code: "CROSS_ORIGIN_REQUEST", message: "same-origin request required" } });
			if (!request.headers?.origin && body.command?.type !== "panel.snapshot" && !trustedLoopback(request)) {
				return send(response, 403, { ok: false, error: { code: "ORIGIN_REQUIRED", message: "browser mutations require a matching Origin; originless requests are limited to trusted loopback clients" } });
			}
			const sessionPresetId = options.resolveSessionPreset
				? await options.resolveSessionPreset({ sessionId: body.sessionId, cwd: body.cwd, request })
				: undefined;
			const value = await controller.command(body.command, { sessionPresetId, sessionId: body.sessionId, cwd: body.cwd });
			return send(response, 200, { ok: true, value });
		} catch (error) {
			return send(response, error?.status ?? (error instanceof TypeError ? 400 : 409), { ok: false, error: diagnosticOf(error, { defaultCode: "PRESET_AUTHORING_ERROR" }) });
		}
	};
}
