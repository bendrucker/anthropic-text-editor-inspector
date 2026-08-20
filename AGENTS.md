# anthropic-text-editor-inspector

A Vite + React single-page app. There is no server: the browser talks to
`api.anthropic.com` directly with a key the user pastes into the app.

Organizations with custom retention get browser-origin requests refused, so the
dev server forwards `/anthropic` to the API with the browser headers stripped.
`lib/endpoint.ts` decides which of the two a given build uses.

- `bun run dev` — dev server
- `bun run build` — static `dist/`, deployable to any static host
- `bun run build:single` — everything inlined into one `dist/index.html`
- `bun run roundtrip` — asserts the Markdown serializer is a fixed point,
  which the `str_replace` matching depends on
