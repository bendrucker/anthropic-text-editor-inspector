# Mechanics

How a streamed `str_replace` call becomes a document mutation, in the order the code runs.

## The custom tool

Anthropic ships a text editor tool. Declaring it takes one line, and the model already knows how to call it:

```ts
{ type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' }
```

This app declares its own instead, because the built-in tool cannot stream its input. The SDK types show the difference. In `@anthropic-ai/sdk/resources/beta/messages/messages.d.ts`, the custom-tool interface carries a field the text editor interfaces do not:

```ts
// BetaTool, the custom-tool shape
eager_input_streaming?: boolean | null
```

`BetaToolTextEditor20250728` has `name`, `type`, `cache_control`, `defer_loading`, `input_examples`, `strict`, and `max_characters`. There is no streaming control on it. Anthropic owns the schema for its own tools, so there is nowhere to ask for input early.

The rest of this project follows from that. `lib/agent.ts` builds a tool named `str_replace` taking the same two parameters the built-in one takes, to reach the flag.

## Eager input streaming

Tool input arrives as `input_json_delta` events either way. The flag changes when they arrive and what state they are in.

Off, the API buffers the model's output and emits fragments of already-valid JSON. Nothing reaches the client until the call is well formed.

On, fragments leave as the model emits them. They are unvalidated, and a fragment can end anywhere, including between the backslash and the `n` of an escape sequence.

The field documents its own default: unset, behavior follows the beta headers on the request. This app sets it explicitly per tool rather than relying on a header, which keeps the control in one place and lets the UI toggle it per run.

## Schema key order

A tool schema is an object, and the model fills it in the order the properties are declared. Declaring `old_str` first means it closes while `new_str` is still arriving, which is the only reason a UI can start rendering before the call ends.

`buildTool` swaps the two so the difference is observable:

```ts
const ordered = options.oldStrFirst
  ? { old_str: OLD_STR_PROPERTY, new_str: NEW_STR_PROPERTY }
  : { new_str: NEW_STR_PROPERTY, old_str: OLD_STR_PROPERTY }
```

Only `properties` changes. `required` stays `['old_str', 'new_str']` in both branches, so the toggle isolates ordering from everything else in the schema.

Order-follows-schema is observed model behavior. Nothing in the API documents it as a guarantee. Build the fallback: when `new_str` closes first, this app still applies the edit correctly at commit time, it just cannot stream anything before then.

## Partial JSON

`JSON.parse` on the accumulated buffer throws for most of the call's life. A third of the way in, the buffer looks like this:

```
{"old_str": "Enterprise revenue grew 22%", "new_str": "Enterprise revenue gre
```

`lib/partial-json.ts` scans it instead of parsing it. `scanEditInput` walks the buffer as a state machine: skip whitespace, read a key, expect a colon, read a value, repeat. It stops at the first thing it cannot finish and returns what it already has.

`readString` does the decoding, and its return type carries the distinction the UI depends on:

```ts
interface StringRead {
  value: string
  complete: boolean
  end: number
}
```

`complete` is true only when a closing quote was found. It is false when the buffer ends mid-string, and false when the buffer ends on a lone backslash or on a `\u` with fewer than four hex digits available:

```ts
// A lone trailing backslash is the front half of an escape still in flight.
if (i + 1 >= buffer.length) return { value, complete: false, end: buffer.length }
```

Withholding the half-decoded escape keeps every prefix the scanner returns a correct prefix of the final string. The UI can append the new characters on each fragment without ever revising what it already showed.

That flag gates the whole interface. `old_str` present and incomplete means the target is still growing. `old_str` present and complete means the target is final even though the call has not ended:

```ts
if (parsed.oldStrComplete && parsed.oldStr && !announced.has(index)) {
```

The app opens a hole in the document at that moment, and every later `new_str` fragment streams into it. Treating "present" as "final" would locate a target from a prefix and edit the wrong text.

## Match semantics

`lib/str-replace.ts` follows Claude Code's Edit tool: a match must be exact and unique, or the edit is refused. Nothing is guessed and nothing is fuzzy-matched. `locateEdit` has one success and three failures: empty `old_str`, zero matches, and more than one match without `replace_all`.

The messages are written as instructions, because the model is the reader:

```ts
message:
  `old_str matched ${matches.length} times and must identify exactly one location.` +
  ' Extend it with surrounding text until it is unique, or set replace_all to true' +
  ' to change every occurrence.',
```

That text goes back verbatim as the tool result. A message that only reports what went wrong wastes the round trip. This one names both recoveries.

`describeNearMiss` appends a second sentence when it can classify the failure. It collapses whitespace on both sides and re-tests:

```ts
const loose = loosen(oldStr)
if (loose && loosen(source).includes(loose)) {
  return ' The text is present but differs in whitespace. Table cells are padded to' +
    ' align columns, so copy the target exactly as it appears, including the padding.'
}
```

Failing that, it checks whether the first line of `old_str` appears in the document, which tells the model the divergence is later in the string rather than at the start.

## Canonical Markdown

The model matches against a string the editor produced. `lib/markdown.ts` serializes the ProseMirror document, and that output is the only form the model is ever shown.

Table serialization is where this bites. The serializer pads cells so columns align. Written naturally, a row reads:

```
| Enterprise | 47 | $58.2M | $19.4M | 22% |
```

Serialized, the same row reads:

```
| Enterprise | 47            | $58.2M      | $19.4M     | 22%        |
```

The first fails to match. `describeNearMiss` exists to say why, and the matcher panel in the app ships that exact string as a probe so the rejection is reachable without spending a token.

`bun run roundtrip` asserts the property the whole scheme rests on:

```
source -> parse -> serialize matches source: true
serialize is idempotent:                     true
```

Idempotence is the requirement. The model sees serializer output, so `serialize(parse(x))` must equal `x` for any `x` the serializer produced. Without it the model builds `old_str` from one string while the matcher searches another, and edits fail in ways that look random. The demo document is checked in already canonical, which is why the first line also passes.

## Two address spaces

The model addresses the document by character offset into a Markdown string. The editor addresses it by ProseMirror position in a tree. `lib/positions.ts` bridges them twice, for two different questions.

`resolveTarget` answers how to apply an edit. It maps top-level blocks to their offsets in the canonical Markdown, finds the single block containing the match, and decides whether the match sits inside that block's plain text. When the match includes Markdown syntax or spans blocks, it widens to the whole node:

```ts
// Absent from the plain text means the match includes Markdown syntax.
if (offset === -1 || text.indexOf(matched, offset + 1) !== -1) {
  return { kind: 'block', from: span.pos, to: span.pos + block.nodeSize }
}
```

Widening is right for applying and wrong for showing. Highlighting four ambiguous matches through `resolveTarget` painted 31 ranges in this app, because every match inside a list item widened to its entire list.

`findTextRanges` answers where to show. It builds a flat transcript of the document's text alongside the editor position of each character, inserting a newline at block boundaries so a needle cannot silently match across them, then returns exact ranges:

```ts
for (let index = 0; index < node.text.length; index += 1) positions.push(pos + index)
```

`showMatches` prefers the exact ranges and falls back only when the two disagree on how many matches exist:

```ts
const exact = findTextRanges(editor.state.doc, needle)
const ranges = exact.length === matches.length ? ... : ...
```

Same document, same match, two questions, two functions.

## Apply paths

`resolveTarget` returns one of three kinds, and each takes a different route into the editor.

`inline` streams. `beginEdit` deletes the matched range, leaving a hole, and records a cursor:

```ts
editor.view.dispatch(
  editor.state.tr.delete(from, to).setMeta('addToHistory', false).setMeta(streamHighlightKey, {
    from, to: from, variant: 'writing',
  }),
)
```

Each `new_str` fragment then inserts at the cursor and advances it. `addToHistory: false` keeps the stream out of the undo stack, so one undo reverts the edit instead of replaying it fragment by fragment.

`block` and `document` do not stream. The editor shows nothing until the tool call completes, at which point `commitEdit` replaces content wholesale from the authoritative document:

```ts
if (!stream || stream.target.kind !== 'inline') {
  editor.commands.setContent(parse(document), { emitUpdate: false })
```

A table edit always lands here, and the reason is structural. `resolveTarget` checks `block.inlineContent` before it considers anything else, and a table node holds rows rather than inline text:

```ts
if (!block.inlineContent) {
  return { kind: 'block', from: span.pos, to: span.pos + block.nodeSize }
}
```

Serialization gives the same answer independently. When an edit changes the widest cell in a column, the serializer re-pads every row in the table. Replacing `Enterprise` with `Enterprise Accounts` in this document's first table rewrites 6 lines from a 1-line edit. An edit that stays inside the current column width, such as `22%` to `31%`, rewrites only its own row. Either way the node is re-serialized whole, so streaming characters into a text range inside a table would leave the surrounding rows in a state the next `old_str` cannot match against.

The badge under each edit in the UI names the path that ran, so the difference is visible rather than inferred.

## The retry loop

`runEdit` loops over turns. After the stream ends it reads `stop_reason`:

```ts
if (message.stop_reason !== 'tool_use') {
  handlers.onDone(...)
  return
}
```

Otherwise the model called the tool, so each `tool_use` block is matched against the working document and a `tool_result` goes back. A rejection carries `is_error` and the matcher's own message:

```ts
results.push({
  type: 'tool_result',
  tool_use_id: block.id,
  is_error: true,
  content: located.message,
})
```

A third case covers input that never became valid JSON, which eager streaming makes reachable. It returns the raw input under an `INVALID_JSON` key so the model can see what it produced.

The loop pushes the results as a user message and starts another turn. The model reads "matched 4 times, extend it with surrounding text", extends `old_str`, and calls again. Turning `Prompt rules` off in the app drops the uniqueness and padding rules from the system prompt, which makes this loop run often enough to watch.

`workingDocument` accumulates across turns:

```ts
workingDocument = applyEdit(workingDocument, located.matches, input.new_str)
```

Each turn is shown the document as of that moment rather than the original, and `applyEdit` sorts matches back-to-front so earlier offsets stay valid under `replace_all`. The rejection event carries that same working document, so a failed retry cannot roll back edits that already succeeded earlier in the run.
