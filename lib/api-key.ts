/**
 * Where the user's key lives.
 *
 * A browser build can only offer localStorage, which is readable by any script
 * running on the origin. The desktop build reaches the OS credential store
 * through Rust, which is why callers go through this seam. Reads are async
 * because the Keychain is.
 *
 * A dev server started with `ANTHROPIC_API_KEY` set authenticates for the
 * browser, so there is no key here at all.
 */
import { invoke } from '@tauri-apps/api/core'
import { TRANSPORT } from './endpoint'

const STORAGE_KEY = 'anthropic-text-editor-inspector.key'

export interface KeyStore {
  read(): Promise<string | null>
  write(key: string): Promise<void>
  clear(): Promise<void>
  /** Where a key given to this build ends up, shown to the user before they paste one. */
  readonly description: string
  /**
   * False when the key comes from the environment, which leaves nothing to
   * paste or remove.
   */
  readonly editable: boolean
}

const browserKeyStore: KeyStore = {
  async read() {
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
    } catch {
      return null
    }
  },
  async write(key) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, key)
    } catch {
      // Private browsing and blocked storage both land here. The key still works
      // for this session, it just will not survive a reload.
    }
  },
  async clear() {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY)
    } catch {
      // Nothing to clear if storage was unavailable.
    }
  },
  description:
    TRANSPORT === 'direct'
      ? 'Stored in this browser only, and sent only to api.anthropic.com.'
      : 'Stored in this browser only, and sent to the API through this build\'s own proxy.',
  editable: true,
}

const keychainKeyStore: KeyStore = {
  async read() {
    return await invoke<string | null>('read_api_key')
  },
  async write(key) {
    await invoke('write_api_key', { key })
  },
  async clear() {
    await invoke('clear_api_key')
  },
  description: 'Stored in your Keychain, and sent only to api.anthropic.com.',
  editable: true,
}

/**
 * What the browser sends as `x-api-key` when the dev server is the one holding
 * the key. The proxy overwrites the header, so the value only has to be
 * something the SDK accepts and a reader can recognize in a network log.
 */
const DEV_SERVER_PLACEHOLDER = 'dev-server-supplied'

/**
 * A key the dev server supplies from its own environment. Nothing is stored,
 * because nothing here is the key: the placeholder is swapped out on the hop
 * through the proxy.
 */
const devServerKeyStore: KeyStore = {
  async read() {
    return DEV_SERVER_PLACEHOLDER
  },
  async write() {},
  async clear() {},
  description: 'Supplied by the dev server from ANTHROPIC_API_KEY. The key never reaches the browser.',
  editable: false,
}

export const keyStore: KeyStore = import.meta.env.VITE_SERVER_SIDE_KEY
  ? devServerKeyStore
  : TRANSPORT === 'tauri'
    ? keychainKeyStore
    : browserKeyStore

export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim())
}
