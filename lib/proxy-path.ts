/**
 * Path the dev server forwards to the API.
 *
 * Shared with `vite.config.ts`, which cannot import the endpoint module because
 * that one reads `import.meta.env` and the config runs outside Vite's env.
 */
export const PROXY_PATH = '/anthropic'
