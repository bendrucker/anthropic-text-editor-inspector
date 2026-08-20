/**
 * Where the user's key lives.
 *
 * A browser build can only offer localStorage, which is readable by any script
 * running on the origin. The desktop build reaches the OS credential store
 * through Rust, which is why callers go through this seam rather than touching
 * storage directly. Reads are async because the Keychain is.
 */
import { invoke } from '@tauri-apps/api/core'
import { IS_DIRECT, IS_TAURI } from './endpoint'

const STORAGE_KEY = 'anthropic-text-editor-inspector.key'

export interface KeyStore {
  read(): Promise<string | null>
  write(key: string): Promise<void>
  clear(): Promise<void>
  /** Where a key given to this build ends up, shown to the user before they paste one. */
  readonly description: string
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
  description: IS_DIRECT
    ? 'Stored in this browser only, and sent only to api.anthropic.com.'
    : 'Stored in this browser only, and sent to the API through this build\'s own proxy.',
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
}

export const keyStore: KeyStore = IS_TAURI ? keychainKeyStore : browserKeyStore

export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim())
}
