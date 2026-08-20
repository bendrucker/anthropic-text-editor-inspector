/**
 * Where the browser sends API requests.
 *
 * An organization with custom retention settings gets browser-origin requests
 * refused, and no client-side header changes that. The request has to reach the
 * API from a server instead, so `bun run dev` forwards `PROXY_PATH` and a dev
 * build points at it. Nothing about the key changes: it still lives in this
 * browser and still travels no further than the machine running the dev server.
 *
 * The desktop build sidesteps all of it, because Rust makes the request and
 * there is no origin to refuse.
 *
 * A deployed web build calls the API directly, which works wherever direct
 * browser access is allowed. Point a self-hosted build at your own proxy by
 * building with `VITE_ANTHROPIC_BASE_URL`.
 */
import { isTauri } from '@tauri-apps/api/core'
import { PROXY_PATH } from './proxy-path'

export const DIRECT_BASE_URL = 'https://api.anthropic.com'

/** True in the desktop build, where requests are issued by Rust. */
export const IS_TAURI = isTauri()

function resolveBaseUrl(): string {
  // The desktop build needs no hop, and its capability scope allows only the
  // API itself, so a proxy URL would be refused before leaving the webview.
  if (IS_TAURI) return DIRECT_BASE_URL

  const configured = import.meta.env.VITE_ANTHROPIC_BASE_URL

  if (typeof configured === 'string' && configured.length > 0) {
    return configured.replace(/\/+$/, '')
  }

  // The SDK concatenates its path onto this, so it has to be absolute. There is
  // no `location` under the Bun scripts, which never proxy.
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    return new URL(PROXY_PATH, location.origin).toString()
  }

  return DIRECT_BASE_URL
}

export const BASE_URL = resolveBaseUrl()

/** Whether the browser itself calls the API, which is what CORS governs. */
export const IS_DIRECT = !IS_TAURI && BASE_URL.startsWith(DIRECT_BASE_URL)
