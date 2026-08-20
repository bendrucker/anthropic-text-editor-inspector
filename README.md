# Text Editor Tool Inspector

> Demonstrates the inner workings of Anthropic's [text editor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool) by providing visibility into the internals of a text editor chatbot

**[Open Web App](https://bendrucker.github.io/anthropic-text-editor-inspector/)**

![The inspector after a finished run: the edited document, the event console grouped by turn, and the run history](docs/screenshot.png)

## Getting Started

This application is bring-your-own-key (BYOK). You must first create an [API key](https://platform.claude.com/dashboard) from your Claude organization. This key is stored on your device and only sent to Anthropic's servers.

## Dev Server Key

Set `ANTHROPIC_API_KEY` in your shell or in a gitignored `.env.local`. `bun run dev` then authenticates for you: the dev server forwards requests to the API and attaches the key on the way through, so the browser never receives it. A badge naming the dev server as the key source replaces the prompt, and a key you pasted earlier is ignored while the variable is set. `bun run preview` serves a build over a server too and deliberately attaches nothing, since that would leave an authenticated relay listening on the port.

## Sequence

```mermaid
sequenceDiagram
    participant C as Claude
    participant A as Inspector
    participant D as Document

    A->>C: prompt, document, tool declaration
    opt built-in tool reads before it edits
        C->>A: tool_use, command "view"
        A->>C: tool_result, the whole document
    end
    C->>A: content_block_start (tool_use)
    C->>A: input_json_delta  {"old_str": "22%
    A->>A: scan buffer, old_str closes
    A->>D: locate the match, open a hole
    D-->>A: paint, target opened
    C->>A: input_json_delta  ", "new_str": "31%
    A->>D: stream the replacement in
    D-->>A: paint, edit settled
    C->>A: message_delta (stop_reason: tool_use)
    A->>C: tool_result, or is_error and the turn repeats
```

[`docs/mechanics.md`](docs/mechanics.md) walks the same path through the code.

## Observability

- **Run inspector:** interleaves wire events and this app's decisions in one console, always in arrival order, since the interleaving is what there is to read. A text filter marks its matches, chips mute a source or an event type, a Gap column carries the wait before each event, and a settings popover folds repeated events into one row.
- **Input buffer:** shows tool input as one growing string, with `old_str` and `new_str` extracted live and labeled *not started*, *streaming*, or *closed*.
- **Matcher:** runs the real matching code against the live document with no model or API key.
- **Runs:** time to first edit for every finished run, split into connect, preamble, and target, so two configurations can be compared rather than described.
- **Paint timing:** stamps when a change reached the screen rather than when the app dispatched it, waiting a frame because an animation-frame callback runs before its frame paints. Each run closes with how much of its wall clock changed nothing.
- **Replay:** re-runs a finished edit at quarter speed.

## Controls

The tool setup row picks the tool and carries three switches: **Prompt rules**, **old_str first**, and **Eager streaming**. Hovering one shows what both of its positions do and marks the one in force. The last two go inert under the built-in tool, which owns its own schema. **Prompt rules** turns out to carry very little. The model satisfies uniqueness and table padding from its own training whether the system prompt states them or not, so the switch measures how little the prompt is carrying. Model, effort, and fast mode sit in the header.

## Editor Tool

The tool selector in the tool setup row runs the same prompt through either tool, so the difference is something you watch rather than something this README asserts.

- **Custom `str_replace`:** this app writes the schema, which is what buys it `eager_input_streaming` and control over key order. Both are user-defined-tool properties.
- **Built-in text editor:** `text_editor_20250728`, whose schema Anthropic writes. Neither switch has anywhere to attach, so both go grey. Input still arrives as `input_json_delta`, buffered and validated per parameter instead of streamed raw, and the console shows how that changes fragment count and whether the replacement renders progressively at all.

Neither tool reliably reaches the first edit sooner. First-byte latency varies by seconds between runs and swamps the difference, and what streaming saves is bounded by how long `old_str` takes to generate, so a short target shows nothing at all. Pick a long one, run it through both, and read the Runs tab.

Server-defined describes the schema, not where the tool runs. The built-in tool comes back as a `tool_use` block this app executes and answers, exactly like the custom one. It addresses a file by path, and there is no file, so the open document stands in at `/document.md` and its other commands are refused as unimplemented. A `view` is answered with the document, and that first read costs a round trip the custom tool never spends.

Match semantics follow Claude Code's `Edit` tool. Matches must be exact and unique or they are refused. Error messages double as retry prompts.

The **Ambiguous targets** prompts each name a string this document repeats, so the bare needle is one the matcher refuses. The model rarely sends it bare: 217 attempts produced 3 rejections, none of them the ambiguous match these prompts were built to provoke. It resolves the repeat before calling the tool instead, by extending `old_str` past it, setting `replace_all`, splitting into several unique edits, or asking which occurrence was meant. Which way out it took is what the console shows.

## CORS

Organizations with [zero data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#what-zdr-does-not-cover) enabled cannot call Anthropic APIs directly from the browser. A rejected preflight is indistinguishable from being offline, so a failed request names the mechanism that failed rather than reporting a connection error. The [macOS desktop build](https://github.com/bendrucker/anthropic-text-editor-inspector/releases) issues requests from Rust, so it works with those keys. Cloning and running `bun run dev` works too, since the dev server forwards the request. Build the desktop app yourself with `bun run desktop:build`.

## Stack

- **[React](https://react.dev)** and **[Vite](https://vite.dev):** Vite builds the app, and its dev server forwards `/anthropic` for a local run.
- **[Tiptap](https://tiptap.dev):** the document is a Tiptap editor, and its Markdown serializer decides the exact text `str_replace` matches against.
- **[Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript):** streams the message and exposes the raw events the console renders.
- **[Tauri](https://tauri.app):** the desktop build issues requests from Rust, so the restriction above does not apply, and it stores the key in the system keychain.

## Building Locally

```bash
bun run build
```

The build emits a `dist/` directory that has to be served, which `bun run preview` does locally. Use `build:single` for a self-contained `index.html` with no external scripts or styles, which does open straight from disk.
