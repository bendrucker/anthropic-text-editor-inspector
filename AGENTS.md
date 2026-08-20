# anthropic-text-editor-inspector

A Vite + React single-page app. There is no server: the browser talks to
`api.anthropic.com` directly with a key the user pastes into the app. Local dev
has one exception, below.

Organizations with custom retention get browser-origin requests refused. Two
builds get around it: the dev server forwards `/anthropic` with the browser
headers stripped, and the Tauri desktop build issues the request from Rust.
`lib/endpoint.ts` decides which path a given build takes, and `lib/api-key.ts`
picks `localStorage` or the Keychain to match.

A dev server started with `ANTHROPIC_API_KEY` set forwards the key with the
request. The bundle gets a boolean saying a key exists, never the key, and
`lib/api-key.ts` swaps in a store that sends a placeholder the proxy overwrites.
That store also requires the proxy transport, because `tauri dev` runs the same
dev server under the webview but issues its requests from Rust.

- `bun run dev` — dev server
- `bun run build` — static `dist/`, deployable to any static host
- `bun run build:single` — everything inlined into one `dist/index.html`
- `bun run roundtrip` — asserts the Markdown serializer is a fixed point,
  which the `str_replace` matching depends on
