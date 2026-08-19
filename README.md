# Text Editor Tool Inspector

Claude edits a Markdown document through a `str_replace` tool while every mechanism behind that edit stays on screen: the raw JSON fragments arriving on the wire, the partial buffer they accumulate into, the match that lands or gets refused, and the document mutation that follows.

**[Try it live](https://bendrucker.github.io/anthropic-text-editor-inspector/)** with your own Anthropic API key.

Handing a one-paragraph edit to a full coding agent takes about a minute. Streaming tool input straight into an editor takes about three seconds. This app exists to show what happens in those three seconds, and answers what the API reference states but cannot show: what `eager_input_streaming` actually sends, why key order in a tool schema decides how early a UI can react, and what an ambiguous match looks like from both sides.

## What you can watch

**The run inspector** interleaves two streams in one timeline. Wire events on one side (`content_block_start`, every `input_json_delta` with its raw fragment, stop reason), the app's own decisions on the other (target resolved, hole opened, tool result sent, turn 2 started). The mapping between them is the part worth reading, which is why neither gets its own tab.

**The input buffer** shows accumulated tool input as one growing string, with `old_str` and `new_str` pulled out of it live and each labeled *not started*, *streaming*, or *closed*. Watching `old_str` close while `new_str` is still filling is the whole trick in one view.

**The matcher** runs `locateEdit` against the live document with no model and no API key. Type `Commit` and get the four-match rejection verbatim. Paste a table row with its padding collapsed and get the whitespace explanation. Every rejection the tool can produce is reachable for free.

**Ambiguity traps** are built into the document. Three suggested prompts each name something appearing more than once, so the first `old_str` the model reaches for gets refused. They are labeled as traps, because an ambush that looks like a bug teaches nothing.

**Replay** re-runs a finished edit through the same handlers at quarter speed. Throttling the live path would misrepresent what streaming is, so the first run is real and the replay is a retelling.

## What you can change

The tool setup strip reconfigures the tool itself. Anything switched off the shipping default turns amber.

- **Prompt rules.** On, the system prompt pre-teaches uniqueness and table padding, and the model rarely trips. Off, it learns the same constraints from tool results, so the retry loop actually runs. Turn this off before trying the traps.
- **old_str first.** Declaration order in the schema. Flip it and the target stays unknown until the replacement has fully streamed, leaving the document inert until the very end. Order-follows-schema is observed model behavior rather than a spec guarantee, so the toggle lets you watch it hold instead of taking it on faith.
- **Eager streaming.** Off, tool input lands in validated bursts and nothing can render early.

The header carries model, effort, and fast mode. Effort mostly moves how much preamble arrives before the tool call, which shows up in the latency breakdown under each run.

## Why a custom tool

The built-in `text_editor_20250728` is Anthropic-defined and cannot stream its input eagerly. A user-defined tool can, via `eager_input_streaming: true`. That single difference is what makes progressive rendering possible, so this app declares its own `str_replace`.

Streamed input arrives as raw JSON fragments that may split mid-escape, so the scanner reads fields out of the accumulated buffer instead of parsing it. `old_str` typically settles about a third of the way through a call.

Match semantics follow Claude Code's Edit tool: exact and unique, or refused. Error messages are written to work as retry prompts, because that is what they become. The Markdown serializer pads table columns, so canonical document form comes from the serializer itself and `bun run roundtrip` asserts that serializing is a fixed point. Two apply paths exist because a single-cell table edit re-pads its whole column: inline edits stream into the editor, structural edits replace the node whole.

## How it works

Five modules cover the whole path.

| Module | What lives there |
| --- | --- |
| `lib/agent.ts` | The edit loop. Builds the tool, streams the response, records both timelines, sends tool results back. |
| `lib/partial-json.ts` | `scanEditInput` reads `old_str` and `new_str` out of a buffer that is not yet valid JSON. |
| `lib/str-replace.ts` | `locateEdit` and `applyEdit`. Exact-and-unique matching, and the rejection messages. |
| `lib/positions.ts` | `resolveTarget` answers where to apply an edit. `findTextRanges` answers where to highlight one. |
| `components/run-inspector.tsx` | The two-stream timeline and the buffer panel. |

[`docs/mechanics.md`](docs/mechanics.md) goes deeper on the streaming protocol, schema ordering, and the matching rules.

## Your API key

There is no server and no telemetry. The browser calls `api.anthropic.com` directly and your key goes nowhere else.

The key lives in `localStorage`, which any script on the origin can read. That is the only option a static page has, so prefer a key you can revoke afterward over your main one.

Direct browser calls require `anthropic-dangerous-direct-browser-access`. Anthropic gates them behind that deliberately alarming name because the key ends up on the client, which is the right tradeoff for a BYO-key playground and the wrong one for a product.

## Running it

```bash
bun install
bun run dev
```

```bash
bun run build          # dist/, ~400 kB gzipped, any static host
bun run build:single   # one self-contained dist/index.html
bun run roundtrip      # serializer fixed-point check
bun run typecheck
```

Asset paths are relative, so a GitHub Pages project subpath works without configuration.
