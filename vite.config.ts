import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import { PROXY_PATH } from './lib/proxy-path.ts'

// `bun run build:single` inlines every asset into one index.html.
const singleFile = process.env.SINGLE_FILE === '1'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(singleFile ? [viteSingleFile()] : [])],
  // Relative so the build works from a project subpath, as GitHub Pages serves.
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
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
})
