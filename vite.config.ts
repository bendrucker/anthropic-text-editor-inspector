import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import { PROXY_PATH } from './lib/proxy-path.ts'

// `bun run build:single` inlines every asset into one index.html.
const singleFile = process.env.SINGLE_FILE === '1'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Testing without pasting a key: the dev server authenticates on the
  // browser's behalf, so `ANTHROPIC_API_KEY` stays in the shell or in a
  // gitignored `.env.local` and never reaches the bundle. Only the dev server
  // can do this, and only when requests actually go through its proxy, which a
  // build pointed at some other base URL does not.
  const serverKey =
    command === 'serve' && !env.VITE_ANTHROPIC_BASE_URL ? env.ANTHROPIC_API_KEY : undefined

  return {
    plugins: [react(), tailwindcss(), ...(singleFile ? [viteSingleFile()] : [])],
    // Relative so the build works from a project subpath, as GitHub Pages serves.
    base: './',
    resolve: {
      alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
    },
    // The app needs to know a key is coming from somewhere to stop asking for
    // one. It gets the fact, never the key.
    define: {
      'import.meta.env.VITE_SERVER_SIDE_KEY': JSON.stringify(Boolean(serverKey)),
    },
    // Anthropic refuses browser-origin requests from organizations that set
    // custom retention, which no header on the browser side can talk it out of.
    // Forwarding through the dev server is what makes those keys work: the hop
    // drops the headers that mark the request as coming from a page, so the API
    // sees an ordinary server call. The key goes no further than this machine.
    server: {
      proxy: {
        [PROXY_PATH]: {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.slice(PROXY_PATH.length),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
              proxyReq.removeHeader('referer')
              proxyReq.removeHeader('anthropic-dangerous-direct-browser-access')
              // Replaces the placeholder the browser sent, or a real key the
              // user pasted before the environment supplied one.
              if (serverKey) proxyReq.setHeader('x-api-key', serverKey)
            })
          },
        },
      },
    },
    build: {
      outDir: 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 2000,
    },
  }
})
