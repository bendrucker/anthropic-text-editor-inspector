/**
 * Where the browser sends API requests.
 *
 * An organization with custom retention settings gets browser-origin requests
 * refused, and no client-side header changes that. The request has to reach the
 * API from a server instead, so `bun run dev` forwards `PROXY_PATH` and a dev
 * build points at it. Nothing about the key changes: it still lives in this
 * browser and still travels no further than the machine running the dev server.
 *
 * A deployed build calls the API directly, which works wherever direct browser
 * access is allowed. Point a self-hosted build at your own proxy by building
 * with `VITE_ANTHROPIC_BASE_URL`.
 */
import { PROXY_PATH } from './proxy-path'

export const DIRECT_BASE_URL = 'https://api.anthropic.com'

function resolveBaseUrl(): string {
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

/** Whether requests reach the API from the browser with no hop in between. */
export const IS_DIRECT = BASE_URL.startsWith(DIRECT_BASE_URL)
