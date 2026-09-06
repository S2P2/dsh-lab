function statusOf(value) {
	if (!value || typeof value !== "object") return undefined;
	if (typeof value.status === "string") return { status: value.status };
	return undefined;
}

/** Return the stable, JSON-safe diagnostic exposed outside the Host boundary. */
export function diagnosticOf(error, { defaultCode } = {}) {
	const code = error && typeof error === "object" && typeof error.code === "string" ? error.code : defaultCode;
	const diagnostic = {
		message: error instanceof Error ? error.message : String(error),
		...(code ? { code } : {}),
	};
	const recovery = statusOf(error?.recovery);
	const fallbackRecovery = statusOf(error?.fallbackRecovery);
	if (recovery) diagnostic.recovery = recovery;
	if (fallbackRecovery) diagnostic.fallbackRecovery = fallbackRecovery;
	if (typeof error?.recoveryState === "string") diagnostic.recoveryState = error.recoveryState;
	return Object.freeze(diagnostic);
}
