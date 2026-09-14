import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_NAMESPACE,
  moveBackend,
  toggleBackend,
  deriveBackendStates,
  stagedSectionFromDraft,
  diffSectionOps,
  BACKEND_CREDENTIAL_REFS,
} from '../src/client.js'

/**
 * Ticket #92: the card's pure logic — reorder/enable/disable staging, the
 * four-state vocabulary, and the settings-section diff that reaches the
 * revision-fenced scope.mutate. The React layer stays thin over these.
 */

const backends = () => [
  { id: 'exa', enabled: true },
  { id: 'tavily', enabled: true },
  { id: 'codex', enabled: true },
]

test('client.js imports headless (guarded ModuleLoader)', () => {
  assert.equal(SETTINGS_NAMESPACE, 'web-search-router')
  assert.deepEqual(BACKEND_CREDENTIAL_REFS, { exa: 'EXA_API_KEY', tavily: 'TAVILY_API_KEY', zai: 'ZAI_API_KEY' })
})

test('moveBackend moves one entry and clamps at bounds', () => {
  const list = backends()
  const up = moveBackend(list, 'tavily', -1)
  assert.deepEqual(up.map((b) => b.id), ['tavily', 'exa', 'codex'])
  assert.deepEqual(list.map((b) => b.id), ['exa', 'tavily', 'codex'], 'pure: input untouched')
  assert.deepEqual(moveBackend(list, 'exa', -1).map((b) => b.id), ['exa', 'tavily', 'codex'], 'top bound')
  assert.deepEqual(moveBackend(list, 'codex', 1).map((b) => b.id), ['exa', 'tavily', 'codex'], 'bottom bound')
  assert.equal(moveBackend(list, 'brave', 1), list, 'unknown id: same list')
})

test('toggleBackend preserves position', () => {
  const list = toggleBackend(backends(), 'tavily', false)
  assert.deepEqual(list.map((b) => [b.id, b.enabled]), [
    ['exa', true],
    ['tavily', false],
    ['codex', true],
  ])
})

test('deriveBackendStates: all four states, priority order', () => {
  const states = deriveBackendStates({
    backends: [
      { id: 'exa', enabled: true },
      { id: 'tavily', enabled: false },
      { id: 'zai', enabled: true },
      { id: 'duckduckgo', enabled: true },
      { id: 'searxng', enabled: true },
    ],
    readiness: { exa: true, tavily: true, zai: false, searxng: false },
    health: [{ id: 'exa', state: 'cooling', cooldownUntil: 2, lastFailureClass: 'rate_limit' }],
  })
  assert.deepEqual(
    states.map((s) => [s.id, s.status]),
    [
      ['exa', 'cooling-down'],
      ['tavily', 'disabled'],
      ['zai', 'needs-setup'],
      ['duckduckgo', 'ready'],
      ['searxng', 'needs-setup'],
    ],
  )
  assert.equal(states[0].detail, 'rate_limit', 'recent failure class is secondary detail')
  // disabled wins over everything; needs-setup beats cooling
  const disabledAndCooling = deriveBackendStates({
    backends: [{ id: 'exa', enabled: false }],
    readiness: { exa: false },
    health: [{ id: 'exa', state: 'cooling' }],
  })
  assert.equal(disabledAndCooling[0].status, 'disabled')
  const setupAndCooling = deriveBackendStates({
    backends: [{ id: 'searxng', enabled: true }],
    readiness: { searxng: false },
    health: [{ id: 'searxng', state: 'cooling' }],
  })
  assert.equal(setupAndCooling[0].status, 'needs-setup')
  // unknown readiness fact (no data) reads as ready, never blocks rendering
  assert.equal(deriveBackendStates({ backends: [{ id: 'codex', enabled: true }] })[0].status, 'ready')
})

test('stagedSectionFromDraft normalizes the save payload', () => {
  const section = stagedSectionFromDraft({
    backends: [{ id: 'exa', enabled: true }, { id: 'tavily', enabled: false }],
    attemptTimeoutMs: 3000,
    overallTimeoutMs: 12000,
    maxRetriesPerBackend: 0,
    searxngBaseUrl: '  https://searx.example  ',
  })
  assert.deepEqual(section, {
    backends: [{ id: 'exa', enabled: true }, { id: 'tavily', enabled: false }],
    attemptTimeoutMs: 3000,
    overallTimeoutMs: 12000,
    maxRetriesPerBackend: 0,
    searxng: { baseUrl: 'https://searx.example' },
  })
  const minimal = stagedSectionFromDraft({ backends: [] })
  assert.deepEqual(minimal, { backends: [] }, 'absent knobs are omitted, not written')
})

test('diffSectionOps produces only changed fields as set/unset ops', () => {
  const current = {
    backends: [{ id: 'exa', enabled: true }],
    attemptTimeoutMs: 5000,
    overallTimeoutMs: 15000,
    maxRetriesPerBackend: 1,
    searxng: { baseUrl: '' },
  }
  const desired = stagedSectionFromDraft({
    backends: [{ id: 'exa', enabled: false }],
    attemptTimeoutMs: 5000,
    overallTimeoutMs: 15000,
    maxRetriesPerBackend: 1,
    searxngBaseUrl: 'https://searx.example',
  })
  assert.deepEqual(diffSectionOps(current, desired), [
    { op: 'set', path: ['backends'], value: [{ id: 'exa', enabled: false }] },
    { op: 'set', path: ['searxng'], value: { baseUrl: 'https://searx.example' } },
  ])
  assert.deepEqual(diffSectionOps(current, stagedSectionFromDraft({
    backends: current.backends,
    attemptTimeoutMs: current.attemptTimeoutMs,
    overallTimeoutMs: current.overallTimeoutMs,
    maxRetriesPerBackend: current.maxRetriesPerBackend,
    searxngBaseUrl: '',
  })), [], 'identical sections produce zero ops (no revision burn)')
  assert.deepEqual(diffSectionOps({}, { backends: [] }), [{ op: 'set', path: ['backends'], value: [] }])
  assert.deepEqual(diffSectionOps({ attemptTimeoutMs: 5000 }, {}), [{ op: 'unset', path: ['attemptTimeoutMs'] }])
})
