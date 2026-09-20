/**
 * dsh-web-search-router — browser Settings card (ticket #92).
 *
 * Registers in the `settings.plugin.item` slot (ctx.slots) with writes
 * through `ctx.settingsScope` (revision-fenced `mutate` path-ops), following
 * the dsh-quota-bar client packaging (window.__ModuleLoader__, require'd
 * React, createElement — no build step) and the codex-connect card
 * registration shape. Reorder/enable-disable/SearXNG URL/global knobs are
 * staged locally and saved as one diff; status uses the four-state
 * vocabulary; the diagnostics view renders ONLY the host ring's whitelisted
 * fields; credential affordances are reference names — this card never
 * touches secret values.
 *
 * Pure helpers are exported at module top level so `node --test` can
 * exercise them without a browser (the ModuleLoader block is guarded).
 * @module
 */

/** The plugin-owned settings namespace (mirrors src/settings.js). */
export const SETTINGS_NAMESPACE = 'web-search-router'

/** The four primary status states (spec): exactly these, in this order of priority. */
export const STATUS_VALUES = ['ready', 'needs-setup', 'cooling-down', 'disabled']

/**
 * Move one backend within the ordered list. Bounds clamp; other entries keep
 * their relative positions (disabling preserves position — same list).
 * @param {{id: string, enabled: boolean}[]} backends @param {string} id @param {-1 | 1} direction
 */
export function moveBackend(backends, id, direction) {
  const index = backends.findIndex((entry) => entry.id === id)
  if (index === -1) return backends
  const target = index + direction
  if (target < 0 || target >= backends.length) return backends
  const next = [...backends]
  const [entry] = next.splice(index, 1)
  next.splice(target, 0, entry)
  return next
}

/** Toggle one backend's enabled flag in place (position preserved). */
export function toggleBackend(backends, id, enabled) {
  return backends.map((entry) => (entry.id === id ? { id, enabled: enabled !== false } : entry))
}

/**
 * Derive the four-state status for every chain backend.
 * Priority: disabled (user intent) > needs-setup (missing config) >
 * cooling-down (health) > ready. Recent failure class rides as `detail`.
 * @param {{backends: {id: string, enabled: boolean}[], readiness: Record<string, boolean>, health: {id: string, state: string, lastFailureClass?: string}[]}} input
 * @returns {{id: string, enabled: boolean, status: string, detail?: string}[]}
 */
export function deriveBackendStates({ backends, readiness = {}, health = [] }) {
  const healthById = new Map(health.map((entry) => [entry.id, entry]))
  return backends.map((entry) => {
    if (entry.enabled === false) return { id: entry.id, enabled: false, status: 'disabled' }
    if (readiness[entry.id] === false) return { id: entry.id, enabled: true, status: 'needs-setup' }
    const healthEntry = healthById.get(entry.id)
    if (healthEntry !== undefined && (healthEntry.state === 'cooling' || healthEntry.state === 'unavailable-until-state-change')) {
      return {
        id: entry.id,
        enabled: true,
        status: 'cooling-down',
        detail: healthEntry.lastFailureClass,
      }
    }
    return { id: entry.id, enabled: true, status: 'ready' }
  })
}

/**
 * The staged settings section a Save writes: the ordered backend list, the
 * global knobs, and the SearXNG base URL.
 * @param {{backends: {id: string, enabled: boolean}[], attemptTimeoutMs?: number, overallTimeoutMs?: number, maxRetriesPerBackend?: number, searxngBaseUrl?: string}} draft
 */
export function stagedSectionFromDraft(draft) {
  return {
    backends: draft.backends.map((entry) => ({ id: entry.id, enabled: entry.enabled !== false })),
    ...(typeof draft.attemptTimeoutMs === 'number' ? { attemptTimeoutMs: draft.attemptTimeoutMs } : {}),
    ...(typeof draft.overallTimeoutMs === 'number' ? { overallTimeoutMs: draft.overallTimeoutMs } : {}),
    ...(typeof draft.maxRetriesPerBackend === 'number' ? { maxRetriesPerBackend: draft.maxRetriesPerBackend } : {}),
    ...(typeof draft.searxngBaseUrl === 'string' ? { searxng: { baseUrl: draft.searxngBaseUrl.trim() } } : {}),
  }
}

/**
 * Diff a staged section against the current resolved value into path-ops for
 * `settingsScope.mutate` (revision-fenced at the call site). Only changed
 * top-level fields produce ops; an unchanged field never writes.
 * @param {object} current the scope snapshot's resolved value
 * @param {object} desired the staged section
 * @returns {{op: 'set' | 'unset', path: string[], value?: unknown}[]}
 */
export function diffSectionOps(current, desired) {
  const ops = []
  const fields = ['backends', 'attemptTimeoutMs', 'overallTimeoutMs', 'maxRetriesPerBackend', 'searxng']
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  for (const field of fields) {
    const before = current?.[field]
    const after = desired[field]
    if (same(before, after)) continue
    ops.push(after === undefined ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value: after })
  }
  return ops
}

/** Credential reference per keyed backend, for the card's configure affordances. */
export const BACKEND_CREDENTIAL_REFS = {
  exa: 'EXA_API_KEY',
  tavily: 'TAVILY_API_KEY',
  zai: 'ZAI_API_KEY',
}

if (typeof window !== 'undefined' && window.__ModuleLoader__) {
  window.__ModuleLoader__.load({
    id: '@s2p2/dsh-web-search-router',
    factory: (require) => {
      const module = { exports: {} }
      const exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
      const React = require('react')
      const h = React.createElement

      const NAME = 'dsh-web-search-router-client'
      const inject = ['slots', 'settingsScope']

      const STATUS_LABELS = {
        ready: 'Ready',
        'needs-setup': 'Needs setup',
        'cooling-down': 'Cooling down',
        disabled: 'Disabled',
      }

      /* ---------------- host state (loopback route) ---------------- */

      let hostState = { health: [], diagnostics: [], readiness: {}, chain: [], generatedAt: 0 }
      const subs = new Set()
      const emit = () => subs.forEach((f) => f())

      async function pollState() {
        try {
          const resp = await fetch('/dsh-web-search-router/state', { cache: 'no-store' })
          if (!resp.ok) return
          const next = await resp.json()
          if (next && typeof next === 'object') {
            hostState = {
              health: Array.isArray(next.health) ? next.health : [],
              diagnostics: Array.isArray(next.diagnostics) ? next.diagnostics : [],
              readiness: typeof next.readiness === 'object' && next.readiness !== null ? next.readiness : {},
              chain: Array.isArray(next.chain) ? next.chain : [],
              generatedAt: next.generatedAt || 0,
            }
            emit()
          }
        } catch {
          /* host route absent (no webServer) — settings-only card degrades silently */
        }
      }

      const useHostState = () =>
        React.useSyncExternalStore(
          (f) => {
            subs.add(f)
            return () => subs.delete(f)
          },
          () => hostState,
        )

      /* ---------------- card component ---------------- */

      function WebSearchRouterCard({ configScope }) {
        const scope = configScope
        const subscribe = React.useCallback((listener) => scope?.subscribe?.(listener) ?? (() => {}), [scope])
        const getSnapshot = React.useCallback(() => scope?.getSnapshot?.() ?? { status: 'loading' }, [scope])
        const settings = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
        const host = useHostState()

        React.useEffect(() => {
          pollState()
          const timer = setInterval(pollState, 15_000)
          return () => clearInterval(timer)
        }, [])

        const resolved = settings.status === 'ready' ? settings.value : undefined
        const [draft, setDraft] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [feedback, setFeedback] = React.useState('idle')
        const baseline = React.useRef(null)

        React.useEffect(() => {
          if (resolved !== undefined && baseline.current === undefined) {
            baseline.current = resolved
            setDraft({
              backends: Array.isArray(resolved.backends) ? resolved.backends.map((b) => ({ ...b })) : [],
              attemptTimeoutMs: resolved.attemptTimeoutMs,
              overallTimeoutMs: resolved.overallTimeoutMs,
              maxRetriesPerBackend: resolved.maxRetriesPerBackend,
              searxngBaseUrl: resolved.searxng?.baseUrl ?? '',
            })
          }
        }, [resolved])

        if (draft === null) {
          return h('div', { className: 'dsh-wsr-card' }, h('div', { className: 'dsh-wsr-muted' }, 'Loading settings…'))
        }

        const dirty = JSON.stringify(stagedSectionFromDraft(draft)) !== JSON.stringify(stagedSectionFromDraft({
          backends: baseline.current?.backends ?? [],
          attemptTimeoutMs: baseline.current?.attemptTimeoutMs,
          overallTimeoutMs: baseline.current?.overallTimeoutMs,
          maxRetriesPerBackend: baseline.current?.maxRetriesPerBackend,
          searxngBaseUrl: baseline.current?.searxng?.baseUrl ?? '',
        }))

        const states = deriveBackendStates({
          backends: draft.backends,
          readiness: host.readiness,
          health: host.health,
        })
        const stateById = new Map(states.map((s) => [s.id, s]))

        const save = async () => {
          if (scope === undefined || !settings.writable || busy) return
          setBusy(true)
          setFeedback('idle')
          try {
            const current = scope.getSnapshot()
            if (current.value === undefined || current.revision === undefined) throw new Error('Host settings are unavailable')
            const ops = diffSectionOps(current.value, stagedSectionFromDraft(draft))
            if (ops.length > 0) await scope.mutate(ops, current.revision)
            const accepted = scope.getSnapshot().value
            baseline.current = accepted
            setDraft({
              backends: Array.isArray(accepted.backends) ? accepted.backends.map((b) => ({ ...b })) : [],
              attemptTimeoutMs: accepted.attemptTimeoutMs,
              overallTimeoutMs: accepted.overallTimeoutMs,
              maxRetriesPerBackend: accepted.maxRetriesPerBackend,
              searxngBaseUrl: accepted.searxng?.baseUrl ?? '',
            })
            setFeedback('saved')
          } catch {
            setFeedback('error')
          } finally {
            setBusy(false)
          }
        }

        const discard = () => {
          const current = baseline.current
          if (current === undefined) return
          setDraft({
            backends: Array.isArray(current.backends) ? current.backends.map((b) => ({ ...b })) : [],
            attemptTimeoutMs: current.attemptTimeoutMs,
            overallTimeoutMs: current.overallTimeoutMs,
            maxRetriesPerBackend: current.maxRetriesPerBackend,
            searxngBaseUrl: current.searxng?.baseUrl ?? '',
          })
          setFeedback('idle')
        }

        const numberField = (label, key) =>
          h('label', { className: 'dsh-wsr-knob' },
            h('span', null, label),
            h('input', {
              type: 'number',
              min: key === 'maxRetriesPerBackend' ? 0 : 100,
              value: draft[key] ?? '',
              disabled: settings.writable === false,
              onChange: (event) => setDraft({ ...draft, [key]: Number(event.target.value) || undefined }),
            }),
          )

        return h('div', { className: 'dsh-wsr-card' },
          h('h3', null, 'Web Search Router'),
          h('p', { className: 'dsh-wsr-muted' }, 'Ordered fallback chain — first backend with a usable result serves the search.'),

          h('table', { className: 'dsh-wsr-backends' },
            h('thead', null, h('tr', null, h('th', null, 'Backend'), h('th', null, 'Status'), h('th', null, 'On'), h('th', null, 'Order'))),
            h('tbody', null, ...draft.backends.map((entry, index) => {
              const state = stateById.get(entry.id) ?? { status: 'ready' }
              const ref = BACKEND_CREDENTIAL_REFS[entry.id]
              return h('tr', { key: entry.id, className: `dsh-wsr-${state.status}` },
                h('td', null, entry.id,
                  state.status === 'needs-setup' && ref !== undefined
                    ? h('div', { className: 'dsh-wsr-hint' }, `Configure the ${ref} credential to enable this backend.`)
                    : null,
                  state.detail !== undefined ? h('div', { className: 'dsh-wsr-hint' }, `Last failure: ${state.detail}`) : null),
                h('td', null, STATUS_LABELS[state.status] ?? state.status),
                h('td', null, h('input', {
                  type: 'checkbox',
                  checked: entry.enabled !== false,
                  disabled: settings.writable === false,
                  onChange: (event) => setDraft({ ...draft, backends: toggleBackend(draft.backends, entry.id, event.target.checked) }),
                })),
                h('td', null,
                  h('button', {
                    'aria-label': `Move ${entry.id} up`,
                    disabled: index === 0 || settings.writable === false,
                    onClick: () => setDraft({ ...draft, backends: moveBackend(draft.backends, entry.id, -1) }),
                  }, '↑'),
                  h('button', {
                    'aria-label': `Move ${entry.id} down`,
                    disabled: index === draft.backends.length - 1 || settings.writable === false,
                    onClick: () => setDraft({ ...draft, backends: moveBackend(draft.backends, entry.id, 1) }),
                  }, '↓'),
                ),
              )
            })),
          ),

          h('div', { className: 'dsh-wsr-knobs' },
            numberField('Attempt timeout (ms)', 'attemptTimeoutMs'),
            numberField('Overall timeout (ms)', 'overallTimeoutMs'),
            numberField('Retries per backend', 'maxRetriesPerBackend'),
            h('label', { className: 'dsh-wsr-knob' },
              h('span', null, 'SearXNG base URL'),
              h('input', {
                type: 'url',
                placeholder: 'https://searxng.internal',
                value: draft.searxngBaseUrl,
                disabled: settings.writable === false,
                onChange: (event) => setDraft({ ...draft, searxngBaseUrl: event.target.value }),
              }),
            ),
          ),

          h('div', { className: 'dsh-wsr-actions' },
            h('button', { onClick: save, disabled: !dirty || busy || settings.writable === false }, 'Save'),
            h('button', { onClick: discard, disabled: !dirty || busy }, 'Discard'),
            feedback !== 'idle' ? h('span', { className: `dsh-wsr-${feedback}` }, feedback === 'saved' ? 'Saved — applies to the next search.' : 'Save failed — settings changed concurrently; reload.') : null,
          ),

          h('details', { className: 'dsh-wsr-diagnostics' },
            h('summary', null, 'Recent searches'),
            host.diagnostics.length === 0
              ? h('div', { className: 'dsh-wsr-muted' }, 'No searches recorded yet.')
              : h('ul', null, ...host.diagnostics.slice(-10).reverse().map((execution, index) =>
                  h('li', { key: `${execution.at}-${index}` },
                    h('span', { className: `dsh-wsr-outcome dsh-wsr-outcome-${execution.outcome}` }, execution.outcome),
                    ' ',
                    h('span', { className: 'dsh-wsr-muted' }, new Date(execution.at).toLocaleTimeString()),
                    h('ul', null, ...(execution.backendAttempts ?? []).map((attempt, attemptIndex) =>
                      h('li', { key: attemptIndex },
                        `${attempt.backend}: ${attempt.outcome}` +
                        (attempt.failureClass !== undefined ? ` (${attempt.failureClass})` : '') +
                        (attempt.retries !== undefined && attempt.retries > 0 ? ` · ${attempt.retries} retry` : '') +
                        (attempt.latencyMs !== null && attempt.latencyMs !== undefined ? ` · ${attempt.latencyMs}ms` : ''),
                      ),
                    )),
                  ),
                )),
          ),
        )
      }

      function apply(ctx) {
        const configScope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
        ctx.slots.inject('settings.plugin.item', () =>
          ctx.slots.register({
            name: 'settings.plugin.item',
            key: SETTINGS_NAMESPACE,
            inject: () => ({ configScope }),
          }, WebSearchRouterCard),
        )
      }

      exports.apply = apply
      exports.inject = inject
      exports.name = NAME
      return module.exports
    },
  })
}
