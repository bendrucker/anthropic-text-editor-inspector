/**
 * Where the user's key lives.
 *
 * A browser build can only offer localStorage, which is readable by any script
 * running on the origin. A Tauri build should replace this module with the
 * macOS Keychain, which is why callers go through the seam rather than touching
 * storage directly.
 */
import { IS_DIRECT } from './endpoint'

const STORAGE_KEY = 'anthropic-text-editor-inspector.key'

export interface KeyStore {
  read(): string | null
  write(key: string): void
  clear(): void
  /** Where a key given to this build ends up, shown to the user before they paste one. */
  readonly description: string
}

export const browserKeyStore: KeyStore = {
  read() {
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
    } catch {
      return null
    }
  },
  write(key) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, key)
    } catch {
      // Private browsing and blocked storage both land here. The key still works
      // for this session, it just will not survive a reload.
    }
  },
  clear() {
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

export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim())
}
