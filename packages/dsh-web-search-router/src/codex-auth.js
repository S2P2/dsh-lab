/**
 * dsh-web-search-router — OpenAI Codex OAuth credential access.
 *
 * VENDORED PATTERN, not a module import: dsh-codex does not export its store.
 * This mirrors its store shape verbatim (strict document, owner-only mode,
 * cross-process file lock, atomic write) over the SAME `$DSH_HOME` document
 * `.openai-codex-auth.json`, so the router and the installed dsh-codex plugin
 * share one refreshable credential with no refresh race. Refresh runs through
 * pi-ai (`createModels` + `getAuth`, which refreshes via `store.modify()` under
 * the file lock) — never hand-rolled. Source: dsh-codex (MIT) src/store.ts,
 * src/auth.ts, src/search.ts; audited copy in dsh-config `.review/dsh-codex/`.
 * @module
 */

import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createModels } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** pi-ai provider id owned by the shared document. */
export const OPENAI_CODEX_PROVIDER = 'openai-codex'

/** Basename of the OAuth document inside the Harness home. */
export const OPENAI_CODEX_AUTH_FILENAME = '.openai-codex-auth.json'

/** Current on-disk format; readers reject every other version. */
const AUTH_FORMAT_VERSION = 1

const CREDENTIAL_KEYS = ['type', 'access', 'refresh', 'expires', 'accountId']

function isENOENT(error) {
  return error?.code === 'ENOENT'
}

/** Default document path under the Harness home. */
export function openAICodexAuthPath(dshHome) {
  return resolve(join(resolveDshHome(dshHome), OPENAI_CODEX_AUTH_FILENAME))
}

/** Reject a credential document readable by another POSIX user. */
async function assertOwnerOnly(filename) {
  let mode
  try {
    mode = (await stat(filename)).mode
  } catch (error) {
    if (isENOENT(error)) return
    throw error
  }
  if (process.platform === 'win32') return
  if ((mode & 0o077) !== 0) {
    throw new Error(`codex auth: ${filename} is readable beyond its owner; run "chmod 600 ${filename}"`)
  }
}

/** Validate the strict JSON document without quoting token-bearing input. */
function parseDocument(text, filename) {
  const value = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`codex auth: ${filename} must contain an object`)
  }
  if (value.version !== AUTH_FORMAT_VERSION) {
    throw new Error(`codex auth: ${filename} has unsupported format version ${String(value.version)}`)
  }
  const credential = value.credential
  if (typeof credential !== 'object' || credential === null || Array.isArray(credential)) {
    throw new Error(`codex auth: ${filename} credential must be an object`)
  }
  if (Object.keys(credential).some((key) => !CREDENTIAL_KEYS.includes(key))) {
    throw new Error(`codex auth: ${filename} credential contains an unknown field`)
  }
  if (credential.type !== 'oauth') throw new Error(`codex auth: ${filename} credential type must be oauth`)
  for (const key of ['access', 'refresh', 'accountId']) {
    if (typeof credential[key] !== 'string' || credential[key].length === 0) {
      throw new Error(`codex auth: ${filename} credential ${key} must be a non-empty string`)
    }
  }
  if (typeof credential.expires !== 'number' || !Number.isFinite(credential.expires) || credential.expires <= 0) {
    throw new Error(`codex auth: ${filename} credential expires must be a positive finite number`)
  }
  return { version: AUTH_FORMAT_VERSION, credential }
}

/** File-backed pi-ai store scoped to the single OpenAI Codex provider. */
export class CodexAuthStore {
  constructor(filename = openAICodexAuthPath()) {
    this.filename = resolve(filename)
  }

  async #readCurrent() {
    await assertOwnerOnly(this.filename)
    let text
    try {
      text = await readFile(this.filename, 'utf8')
    } catch (error) {
      if (isENOENT(error)) return undefined
      throw error
    }
    return structuredClone(parseDocument(text, this.filename).credential)
  }

  async read(providerId) {
    return providerId === OPENAI_CODEX_PROVIDER ? this.#readCurrent() : undefined
  }

  async list() {
    return (await this.#readCurrent()) === undefined ? [] : [{ providerId: OPENAI_CODEX_PROVIDER, type: 'oauth' }]
  }

  async modify(providerId, fn) {
    if (providerId !== OPENAI_CODEX_PROVIDER) {
      throw new Error(`codex auth: store does not own provider "${providerId}"`)
    }
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    return withFileLock(this.filename, async () => {
      const current = await this.#readCurrent()
      const candidate = await fn(current)
      if (candidate === undefined) return current
      const document = parseDocument(JSON.stringify({ version: AUTH_FORMAT_VERSION, credential: candidate }), this.filename)
      await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
      return structuredClone(document.credential)
    })
  }

  async delete(providerId) {
    if (providerId !== OPENAI_CODEX_PROVIDER) return
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    await withFileLock(this.filename, () => rm(this.filename, { force: true }))
  }
}

/** Extract the account id paired with one OAuth access token (JWT claim). */
export function accountIdFromToken(access) {
  const parts = access.split('.')
  if (parts.length !== 3) throw new Error('codex auth: access token is not a JWT')
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  const accountId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new Error('codex auth: access token carries no chatgpt_account_id')
  }
  return accountId
}

/**
 * Codex auth facade for the codex backend: `hasCredential` is the cheap local
 * check (document read, no refresh, no network); `getAuth` returns a usable
 * `{access, accountId}` and may refresh the token through pi-ai's store.
 * @param {object} [options]
 * @returns {{hasCredential: () => Promise<boolean>, getAuth: () => Promise<{access: string, accountId: string} | undefined>}}
 */
export function createCodexAuth(options = {}) {
  const store = options.store ?? new CodexAuthStore(options.dshHome)
  const models = createModels({ credentials: store })
  models.setProvider(openaiCodexProvider())
  return {
    async hasCredential() {
      try {
        return (await store.read(OPENAI_CODEX_PROVIDER)) !== undefined
      } catch {
        return false
      }
    },
    async getAuth() {
      const credential = await store.read(OPENAI_CODEX_PROVIDER)
      if (credential === undefined) return undefined
      const auth = await models.getAuth(OPENAI_CODEX_PROVIDER)
      const access = auth?.auth?.apiKey ?? credential.access
      const accountId = credential.accountId ?? accountIdFromToken(access)
      return { access, accountId }
    },
  }
}
