/**
 * Where the browser sends API requests.
 *
 * An organization with custom retention settings gets browser-origin requests
 * refused, and no client-side header changes that. The request has to reach the
 * API from a server instead, so `bun run dev` forwards `PROXY_PATH` and a dev
 * build points at it. Nothing about the key changes: it still lives in this
 * browser and still travels no further than the machine running the dev server.
 *
 * The desktop build sidesteps all of it by making the request from Rust with no
 * origin on it. The HTTP plugin would otherwise attach the webview's own, which
 * is the browser request being refused, so the build suppresses it.
 *
 * A deployed web build calls the API directly, which works wherever direct
 * browser access is allowed. Point a self-hosted build at your own proxy by
 * building with `VITE_ANTHROPIC_BASE_URL`.
 */
import { isTauri } from '@tauri-apps/api/core'
import { PROXY_PATH } from './proxy-path'

const DIRECT_BASE_URL = 'https://api.anthropic.com'

/**
 * How this build reaches the API. Only `direct` is a browser request in the
 * sense CORS governs, which is the distinction callers need. The three are
 * mutually exclusive, so a caller compares one value instead of combining flags
 * whose invalid pairings it would have to exclude by hand.
 */
export type Transport = 'tauri' | 'direct' | 'proxy'

function resolveEndpoint(): { transport: Transport; baseUrl: string } {
  // The desktop build needs no hop, and its capability scope allows only the
  // API itself, so a proxy URL would be refused before leaving the webview.
  if (isTauri()) return { transport: 'tauri', baseUrl: DIRECT_BASE_URL }

  const configured = import.meta.env.VITE_ANTHROPIC_BASE_URL

  if (typeof configured === 'string' && configured.length > 0) {
    const baseUrl = configured.replace(/\/+$/, '')
    // Pointing a self-hosted build back at the API is still a browser request.
    return {
      transport: baseUrl.startsWith(DIRECT_BASE_URL) ? 'direct' : 'proxy',
      baseUrl,
    }
  }

  // The SDK concatenates its path onto this, so it has to be absolute. There is
  // no `location` under the Bun scripts, which never proxy.
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    return { transport: 'proxy', baseUrl: new URL(PROXY_PATH, location.origin).toString() }
  }

  return { transport: 'direct', baseUrl: DIRECT_BASE_URL }
}

const endpoint = resolveEndpoint()

export const TRANSPORT = endpoint.transport
export const BASE_URL = endpoint.baseUrl
