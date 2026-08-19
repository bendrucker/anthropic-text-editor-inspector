# anthropic-text-editor-inspector

A Vite + React single-page app. There is no server: the browser talks to
`api.anthropic.com` directly with a key the user pastes into the app.

- `bun run dev` — dev server
- `bun run build` — static `dist/`, deployable to any static host
- `bun run build:single` — everything inlined into one `dist/index.html`
- `bun run roundtrip` — asserts the Markdown serializer is a fixed point,
  which the `str_replace` matching depends on
