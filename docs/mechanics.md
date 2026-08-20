# Mechanics

How a streamed `str_replace` call becomes a document mutation, in the order the code runs.

## The custom tool

Anthropic ships a text editor tool. Declaring it takes one line, and the model already knows how to call it:

```ts
{ type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' }
```

The app can declare it, and does when the tool selector says so. It defaults to its own `str_replace` because the built-in tool cannot ask for its input early. The SDK types show the difference. In `@anthropic-ai/sdk/resources/beta/messages/messages.d.ts`, the custom-tool interface carries a field the text editor interfaces do not:

```ts
// BetaTool, the custom-tool shape
eager_input_streaming?: boolean | null
```

`BetaToolTextEditor20250728` carries no streaming control at all. Anthropic owns the schema for its own tools, so there is nowhere to ask for input early, and the tool reference is explicit about the scope: `eager_input_streaming` is available on user-defined tools only.

The rest of this project follows from that. `lib/agent.ts` builds a tool named `str_replace` taking the same two parameters the built-in one takes, to reach the flag. Selecting the built-in tool sends `BUILTIN_EDITOR_TOOL` instead and runs the same loop, which is how the two get compared on one timeline. Its input carries `command` and `path` around the same `old_str` and `new_str`, so the same buffer scanner reads both. The document has no file behind it, so it is addressed as `/document.md`, `view` is answered with the document, and `create` and `insert` come back as errors.

## Eager input streaming

Tool input arrives as `input_json_delta` events either way. The flag changes when they arrive and what state they are in.

Off, the API buffers the model's output and emits fragments of already-valid JSON. Nothing reaches the client until the call is well formed.

On, fragments leave as the model emits them. They are unvalidated, and a fragment can end anywhere, including between the backslash and the `n` of an escape sequence.

The field documents its own default: unset, behavior follows the beta headers on the request. This app sets it explicitly per tool rather than relying on a header, which keeps the control in one place and lets the UI toggle it per run.

## Schema key order

A tool schema is an object, and the model fills it in the order the properties are declared. Declaring `old_str` first means it closes while `new_str` is still arriving, which is the only reason a UI can start rendering before the call ends.

`buildTool` swaps the two so the difference is observable. Only `properties` changes, and `required` stays `['old_str', 'new_str']` in both branches, so the toggle isolates ordering from everything else in the schema.

Order-follows-schema is observed model behavior. Nothing in the API documents it as a guarantee. Build the fallback: when `new_str` closes first, this app still applies the edit correctly at commit time, it just cannot stream anything before then.

## Partial JSON

`JSON.parse` on the accumulated buffer throws for most of the call's life. A third of the way in, the buffer looks like this:

```
{"old_str": "Enterprise revenue grew 22%", "new_str": "Enterprise revenue gre
```

`lib/partial-json.ts` scans it instead of parsing it. `scanEditInput` walks the buffer as a state machine: skip whitespace, read a key, expect a colon, read a value, repeat. It stops at the first thing it cannot finish and returns what it already has.

`readString` does the decoding, and its return type carries the distinction the UI depends on: a `value`, an `end`, and a `complete` flag. `complete` is true only when a closing quote was found. It is false when the buffer ends mid-string, and false when the buffer ends on a lone backslash or on a `\u` with fewer than four hex digits available:

```ts
// A lone trailing backslash is the front half of an escape still in flight.
if (i + 1 >= buffer.length) return { value, complete: false, end: buffer.length }
```

Withholding the half-decoded escape keeps every prefix the scanner returns a correct prefix of the final string. The UI can append the new characters on each fragment without ever revising what it already showed.

That flag gates the whole interface. `old_str` present and incomplete means the target is still growing. `old_str` present and complete means the target is final even though the call has not ended, which is the condition `runEdit` watches for. The app opens a hole in the document at that moment, and every later `new_str` fragment streams into it. Treating "present" as "final" would locate a target from a prefix and edit the wrong text.

## Match semantics

`lib/str-replace.ts` follows Claude Code's Edit tool: a match must be exact and unique, or the edit is refused. Nothing is guessed and nothing is fuzzy-matched. `locateEdit` has one success and three failures: empty `old_str`, zero matches, and more than one match without `replace_all`.

The messages are written as instructions, because the model is the reader:

```ts
`old_str matched ${matches.length} times and must identify exactly one location.` +
  ' Extend it with surrounding text until it is unique' +
  (offerReplaceAll ? ', or set replace_all to true to change every occurrence.' : '.'),
```

That text goes back verbatim as the tool result. A message that only reports what went wrong wastes the round trip. This one names the recoveries the model can actually reach, which is why the second one is conditional: the built-in tool's schema has no `replace_all`, and offering it there would spend the retry on a parameter that does not exist.

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

`bun run roundtrip` asserts the property the whole scheme rests on, once per document:

```
ok    trail-conditions.md     canonical source: true  idempotent: true  traps: 3
```

Idempotence is the requirement. The model sees serializer output, so `serialize(parse(x))` must equal `x` for any `x` the serializer produced. Without it the model builds `old_str` from one string while the matcher searches another, and edits fail in ways that look random. Every document is checked in already canonical, which is what `canonical source` reports.

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

`findTextRanges` answers where to show. It builds a flat transcript of the document's text alongside the editor position of each character, inserting a newline at block boundaries so a needle cannot silently match across them, then returns exact ranges. `showMatches` prefers those and falls back to `resolveTarget` only when the two disagree on how many matches exist.

## Apply paths

`resolveTarget` returns one of three kinds, and each takes a different route into the editor.

`inline` streams. `beginEdit` deletes the matched range, leaving a hole, and records a cursor:

```ts
editor.state.tr.delete(from, to).setMeta('addToHistory', false)
```

Each `new_str` fragment then inserts at the cursor and advances it. `addToHistory: false` keeps the stream out of the undo stack, so one undo reverts the edit instead of replaying it fragment by fragment.

`block` and `document` do not stream. The editor shows nothing until the turn that made the call ends, at which point `commitEdit` replaces content wholesale from the authoritative document:

```ts
if (!stream || stream.target.kind !== 'inline') {
  editor.commands.setContent(parse(document), { emitUpdate: false })
```

A table edit always lands here, and the reason is structural. `resolveTarget` checks `block.inlineContent` before it considers anything else, and a table node holds rows rather than inline text, so it widens to the whole node.

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

The loop pushes the results as a user message and starts another turn. The model reads "matched 4 times, extend it with surrounding text", extends `old_str`, and calls again.

Turning `Prompt rules` off drops the uniqueness and padding rules from the system prompt. It does not reliably produce a rejection, and the refusal rate is the same with them on.

A trap names a string the matcher will refuse, which is a property of the document. It is not a property of what the model sends. Three refusals came out of a couple of hundred live runs against Sonnet 5. The model settles the ambiguity before it calls the tool, almost always by extending `old_str` past the repeat, and it will extend across several hundred characters of identical lines rather than send an ambiguous match. What the `Ambiguous targets` panel demonstrates is that resolving, and it is named for what the document offers.

To reach the loop on demand, name an `old_str` the document does not contain. Zero matches is the one failure a model cannot resolve by looking harder.

`workingDocument` accumulates across turns:

```ts
workingDocument = applyEdit(workingDocument, located.matches, input.new_str)
```

Each turn is shown the document as of that moment rather than the original, and `applyEdit` sorts matches back-to-front so earlier offsets stay valid under `replace_all`. The rejection event carries that same working document, so a failed retry cannot roll back edits that already succeeded earlier in the run.

The screen follows the same boundary. `onTurnEnd` fires once a turn's tool results are settled, and the hook commits every edit that turn produced. A path that cannot stream lands there, while the model is still deciding what to do next, rather than after however many turns it spends afterwards. Committing per turn also keeps the editor's text equal to the document the next turn is shown, which is what lets the next `beginEdit` resolve its target: a second edit to a region the first one rewrote has no match in the document the editor was still holding.

## Two clocks

A run is timed twice, because "when did the bytes arrive" and "when did the screen change" have different answers. `runEdit` owns the wire clock. `startedAt` is taken as the first request leaves the browser, and `since()` stamps every event after it:

```ts
const startedAt = performance.now()
const since = () => Math.round(performance.now() - startedAt)
```

That clock cannot say when anything reached the screen. No browser API reports the paint time of an arbitrary mutation, so `lib/paint.ts` infers it from frame boundaries. `afterPaint` waits two animation frames and then reads the clock, rather than trusting the timestamp the frame was handed:

```ts
export function afterPaint(callback: (atMs: number) => void): void {
  requestAnimationFrame(() => requestAnimationFrame(() => callback(performance.now())))
}
```

The argument a frame callback receives is that frame's nominal start, which a long preceding frame can push earlier than the frame's own end. Reading `performance.now()` inside the callback cannot land before the paint it reports. The cost is an overshoot of at most one frame, taken deliberately, because a clock that claims an early paint is worse than one that rounds late.

`hooks/use-live-document.ts` owns the paint clock and converts every reading onto the run's axis, so paint entries and wire events can be read down one column. It is also why the two can disagree about order. A frame can land after the stream that caused it has closed, and the console prints both where they arrived rather than re-sorting them.

## Where a run's time goes

A run's wall clock is mostly wait, and the app's own contribution to it is routinely a few percent. The breakdown exists to say which part of the rest is which. `EditTiming` records four readings off the wire clock, in order, so the gaps between them are the wait split into spans that sum back to it:

| Span | Reading | What it covers |
| --- | --- | --- |
| retries | `retriesMs` | every turn before the one that produced this edit |
| connect | `firstByteMs - retriesMs` | network and model start-up |
| preamble | `toolStartMs - firstByteMs` | text the model wrote before it called the tool |
| target | `targetMs - toolStartMs` | `old_str` streaming, bounded by the context the match needed |
| render | `editSettledMs - targetMs` | the target closing to that edit finishing landing |

Every reading is measured from the run rather than from the turn, which is why each span is a subtraction. `retriesMs` is the whole cost of the earlier turns, since the run had done nothing else by then, so a second attempt is named as its own span instead of hiding inside the connection.

Every reading also has to describe the same turn. `targetMs` is read fresh each time an `old_str` closes, per tool call:

```ts
// This call's own target, not the run's first. A rejected attempt also
// closes an `old_str`, and the summary reads the timing of whichever
// edit landed, so a shared reading would describe the wrong turn.
const targetMs = since()
```

A run-wide reading among per-turn ones charges the whole retry to whichever gap straddles the turn boundary. When a first attempt is rejected, the rejected turn's `old_str` closes before the retry's tool block has opened, and the subtraction underflows.

Two readings close the run. `settledMs` is on the paint clock and says when the document stopped changing. `totalMs` is on the wire clock and says when the last turn ended. Every edit commits in the turn that produced it, so on a run of several turns `settledMs` lands a whole turn or more before the model stops talking. It can still cross `totalMs` by a frame, because a mutation is only known to be visible once the frame after it has run, and that frame can fall on the far side of the last wire event.

One further reading closes the edit rather than the run. `editSettledMs` is on the paint clock too, and it says when the edit `targetMs` describes finished landing. That is the endpoint the render span subtracts against. The two settles agree on a run that made one edit. They part on every run that made two, because `settledMs` follows the document and moves to whichever edit landed last while `targetMs` stays on the first. Subtract one from the other and a later edit's model time gets reported as this one's render. On a measured three-turn run that read 3.37s for an edit that had rendered in 63ms.

So `EditTiming` holds both. Every field on it describes one edit except `settledMs` and `totalMs`, which describe the run. A refused run carries no `editSettledMs`. Its other spans are borrowed from the attempt the matcher went on to refuse, and a settle beside them would date an edit that never landed.

The bar in the runs list draws those spans in order and leaves bare track wherever nothing happened. The tail is most of a run and bought no visible change, so it gets its honest width and no ink. Every bar is drawn against one denominator, the slowest run listed rounded up to a whole second:

```ts
return Math.max(Math.ceil(slowest / 1000) * 1000, 1000)
```

A bar normalized to its own total draws a two second run and a nine second run at the same width, which is the opposite of what a list of runs is for. Taking the slowest run bare fixes that and leaves the scale sliding, so every new slowest run silently reshrinks the rest. Rounding makes it step, and a round number is one the heading can print, which is what turns bar length back into a duration a reader can name.

The console groups its rows into turns for the same reason. A turn is the unit that costs time, and ten seconds spent without the document changing is the answer to where a run went, which no single row states. Each turn's band carries its elapsed span and whether one of its tool calls applied an edit, and the `request sent` entry that opens the turn is drawn as that band rather than as a row. The verdict is worded against the tool calls because a paint is a separate question. A block-replaced edit commits after its own turn has closed, so its frame lands inside a later turn that applied nothing, and a band claiming the document had not changed would be contradicted by the rows underneath it. A turn that applied no edit and painted anyway prints that paint count beside the verdict.
