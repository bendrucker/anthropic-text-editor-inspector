import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROXY_PATH } from './lib/proxy-path.ts'

// `bun run build:single` inlines every asset into one index.html.
const singleFile = process.env.SINGLE_FILE === '1'

// Both icons come from `design/app-icon/icon-web.svg`, but they reach the page
// differently, because `build:single` copies `public/` next to its one file
// instead of inlining it. A file there would leave that build linking an icon
// nobody deploys.
//
// The favicon is inlined as a `data:` URI, which every target can carry. Safari
// does not reliably honor one for `apple-touch-icon`, so that stays a real PNG
// and the single-file build goes without it: a home-screen bookmark falls back
// to a screenshot, which is a smaller loss than a broken link.
function icons(): Plugin {
  const svg = readFileSync(new URL('design/app-icon/icon-web.svg', import.meta.url), 'utf8')
  const favicon = `data:image/svg+xml,${encodeURIComponent(svg)}`

  return {
    name: 'icons',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'icon', href: favicon }, injectTo: 'head' },
      ...(singleFile
        ? []
        : [
            {
              tag: 'link',
              attrs: { rel: 'apple-touch-icon', href: './apple-touch-icon.png' },
              injectTo: 'head' as const,
            },
          ]),
    ],
  }
}

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Testing without pasting a key: the dev server authenticates on the
  // browser's behalf, so `ANTHROPIC_API_KEY` stays in the shell or in a
  // gitignored `.env.local` and never reaches the bundle. Only the dev server
  // can do this, and only when requests actually go through its proxy, which a
  // build pointed at some other base URL does not.
  //
  // `vite preview` is also a `serve`, and it inherits this proxy while serving
  // a bundle that calls the API directly. Attaching a key there would leave an
  // authenticated relay listening for anyone who can reach the port.
  const serverKey =
    command === 'serve' && !isPreview && !env.VITE_ANTHROPIC_BASE_URL
      ? env.ANTHROPIC_API_KEY
      : undefined

  return {
    plugins: [react(), tailwindcss(), icons(), ...(singleFile ? [viteSingleFile()] : [])],
    // Relative so the build works from a project subpath, as GitHub Pages serves.
    base: './',
    // Nothing in `public/` belongs beside a build whose whole point is being one
    // file, and the touch icon is all that is in there.
    ...(singleFile ? { publicDir: false as const } : {}),
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
