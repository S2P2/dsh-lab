/**
 * Pure failure-policy helpers (ticket #87): which failures the router may
 * retry once, how retry delays are chosen, and how attempt caps clamp to the
 * remaining overall budget. The spec's never-retry set is enforced here even
 * if an adapter mislabels a failure — defense in depth around the adapter
 * contract ("adapters identify the narrow cases eligible for router retry").
 * @module
 */
import { AdapterError } from './errors.js'

/** Per-attempt deadline cap (spec: 5 s), clamped to the remaining overall budget per attempt. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 5_000

/** Overall search deadline: attempts, retries, and retry delays all consume it (spec: 15 s). */
export const DEFAULT_OVERALL_TIMEOUT_MS = 15_000

/** Retries per backend: exactly one for clearly transient failures (spec). */
export const MAX_RETRIES_PER_BACKEND = 1

/** These failure classes are never router-retried; timeout falls back immediately. */
export const NEVER_RETRY_CLASSES = new Set([
  'config',
  'auth',
  'quota',
  'rate_limit',
  'timeout',
  'malformed',
  'empty',
])

/**
 * True when a failure is eligible for the router's one transient retry:
 * an AdapterError explicitly marked retryable (transport failures and
 * 502/503/504-equivalents) whose class is not in the never-retry set.
 * @param {unknown} error
 */
export function isRetryable(error) {
  return error instanceof AdapterError && error.retryable === true && !NEVER_RETRY_CLASSES.has(error.failureClass)
}

/**
 * Small randomized retry delay: `baseMs + rand() * jitterMs`.
 * (Deterministic under an injected `rand` for tests.)
 */
export function retryDelayMs({ baseMs = 200, jitterMs = 300, rand = Math.random } = {}) {
  return baseMs + rand() * jitterMs
}

/**
 * Clamp one attempt's timeout to the remaining overall budget; never negative.
 * @param {number} attemptTimeoutMs @param {number} remainingMs
 */
export function clampAttemptTimeoutMs(attemptTimeoutMs, remainingMs) {
  return Math.max(0, Math.min(attemptTimeoutMs, Math.ceil(remainingMs)))
}
