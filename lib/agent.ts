import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk'
import { locateEdit, applyEdit, type Match } from './str-replace'
import { scanEditInput } from './partial-json'
import { findModel, DEFAULT_MODEL, DEFAULT_EFFORT, type EffortChoice } from './models'
import type { BufferState, TimelineEntry } from './timeline'
import { BASE_URL, TRANSPORT, type Transport } from './endpoint'
import { keyStore } from './api-key'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

/**
 * The edit loop, running in the browser against the user's own key.
 *
 * With no server between the model and the editor, streamed tool input reaches
 * the document as a direct call rather than a re-encoded server event.
 */

/**
 * Which of the two tools a run declares.
 *
 * `custom` is this app's own `str_replace`, whose schema it owns. `builtin` is
 * Anthropic's text editor tool, whose schema it does not. Running the same
 * prompt through both is the point: the timeline says what the difference costs.
 */
export type EditorTool = 'custom' | 'builtin'

/**
 * The built-in tool addresses a file by path, and there is no file. The document
 * is editor state in a browser tab, so it gets one name to be addressed by, and
 * the prompt says that is all the name is.
 */
export const SYNTHETIC_PATH = '/document.md'

/** The model sends the path back with or without its leading slash. Both name the one document. */
function namesDocument(path: string | undefined): boolean {
  return typeof path === 'string' && path.replace(/^\.?\//, '') === SYNTHETIC_PATH.slice(1)
}

/** `replace_all` exists only on the custom schema, so only it can be suggested. */
function editRules(replaceAll: boolean): string {
  return `
Rules for str_replace:
- old_str must reproduce text from the document exactly, including whitespace and punctuation. Table cells are padded so columns align; reproduce that padding.
- old_str must appear exactly once. If the text you want is not unique, extend it with surrounding context until it is.${replaceAll ? ' Set replace_all only when every occurrence should change.' : ''}
- Keep old_str as short as it can be while staying unique.
- Preserve the document's existing voice and formatting conventions.
`
}

/**
 * The rules are a control on how much of the model's behavior the prompt is
 * carrying. Across 144 runs on the Ambiguous targets prompts, half with the
 * rules stated and half without, the model kept `old_str` unique and reproduced
 * table padding either way. Turning them off leaves it working from training
 * alone, and it lands the same edits.
 */
export function buildSystem(guardrails: boolean, editorTool: EditorTool): string {
  const instruction =
    editorTool === 'builtin'
      ? `The document is given below. Make the smallest edit that satisfies the request, using the str_replace command of the text editor tool.

The document is the only file, at ${SYNTHETIC_PATH}. Nothing backs it but this editor, so view and str_replace are the only commands that go anywhere.`
      : 'The document is given below. Make the smallest edit that satisfies the request, using the str_replace tool.'

  return `You edit a Markdown document on behalf of the user.

${instruction}
${guardrails ? editRules(editorTool === 'custom') : ''}
Go straight to the edit. Do not restate the document, announce what you are about to do, or summarize what you did beyond one short sentence. If a request is ambiguous or would require data you do not have, say so instead of inventing figures.`
}

const OLD_STR_PROPERTY = {
  type: 'string' as const,
  description: 'Exact text to replace. Must appear exactly once unless replace_all is true.',
}

const NEW_STR_PROPERTY = { type: 'string' as const, description: 'Replacement text.' }

/**
 * Declaration order is the whole trick. Models emit tool input in schema order,
 * so putting `old_str` first means the target is known while the replacement is
 * still arriving. That ordering is observed behavior rather than a guarantee,
 * which is why the app can flip it and show the difference.
 */
export function buildTool(options: { oldStrFirst: boolean; eager: boolean }): Anthropic.Beta.BetaTool {
  const ordered = options.oldStrFirst
    ? { old_str: OLD_STR_PROPERTY, new_str: NEW_STR_PROPERTY }
    : { new_str: NEW_STR_PROPERTY, old_str: OLD_STR_PROPERTY }

  return {
    name: 'str_replace',
    description:
      'Replace an exact, unique run of text in the document. Fails if old_str is absent or matches more than once.',
    eager_input_streaming: options.eager,
    input_schema: {
      type: 'object',
      properties: {
        ...ordered,
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence instead of requiring a unique match.',
        },
      },
      required: ['old_str', 'new_str'],
    },
  }
}

/**
 * The same job, declared in one object instead of thirty lines.
 *
 * Anthropic owns this schema, which is what the two switches above cost to
 * reach: `eager_input_streaming` is a user-defined-tool field, so
 * `BetaToolTextEditor20250728` has no slot for it, and there is no property list
 * to reorder either. Server-defined means the schema, not the execution. The
 * call still arrives as a `tool_use` block this app runs and answers.
 *
 * `text_editor_20250728` is the version keyed to Claude 4 and later, which every
 * model in the picker is. Earlier models take `text_editor_20250124`.
 */
export const BUILTIN_EDITOR_TOOL: Anthropic.Beta.BetaToolTextEditor20250728 = {
  type: 'text_editor_20250728',
  name: 'str_replace_based_edit_tool',
}

/** One turn of the conversation, as the API sees it. */
export type ConversationTurn = Anthropic.Beta.BetaMessageParam

/**
 * Where the wait goes, measured from the first request leaving the browser.
 *
 * Four readings off one clock, in order, so the gaps between them are the wait
 * split into spans that sum back to it: `retriesMs` is every turn before the one
 * that produced this edit, then network and model start-up up to `firstByteMs`,
 * then preamble the model wrote before it called the tool up to `toolStartMs`,
 * then `old_str` streaming up to `targetMs`, which is bounded by how much
 * context the model needed to make the match unique.
 *
 * Every reading describes the same turn, which is what makes the last three
 * subtract to spans a reader can act on. A run-wide reading among per-turn ones
 * charges the whole retry to whichever gap straddles the turn boundary.
 */
export interface EditTiming {
  firstByteMs: number
  toolStartMs: number
  targetMs: number
  /**
   * When the turn that produced this edit was requested, and which turn it was.
   *
   * Every clock here is measured from the run, not from the turn, so on a retry
   * `firstByteMs` covers the turns before this one as well. Subtracting
   * `retriesMs` is what separates a round trip from a second attempt.
   *
   * It is also the whole cost of those earlier turns, since the run had done
   * nothing else by then, so the breakdown can name the retry as its own span
   * instead of hiding it inside the connection.
   */
  retriesMs?: number
  turn?: number
  /** Length of the target, which bounds how long a replacement can stream for. */
  oldStrChars?: number
  /**
   * The first three are measured here, from wire events. These last three are
   * filled in by whoever owns the document, because only it can say when a
   * change reached the screen and when the run finally stopped.
   */
  paintMs?: number
  /** The first paint carrying replacement text, which is where landing starts. */
  textPaintMs?: number
  /**
   * When the edit these spans describe finished landing.
   *
   * Edit-level, and the only settle that subtracts against `targetMs` to a real
   * render time, because both endpoints then come from the same edit. Read by
   * the `render` span and by the render bar's window. Absent when nothing
   * committed, which is what keeps a refused run from reporting one.
   */
  editSettledMs?: number
  /**
   * When the document stopped changing, across the whole run.
   *
   * Run-level, unlike every other reading here. On a run of one edit the two
   * settles agree, and from the second edit on this one belongs to whichever
   * edit landed last while `targetMs` still belongs to the first. Subtracting
   * them charges the later edit's model time to rendering the earlier one. Read
   * by the tail line, the tail percentage, `extentOf`, and the mark that says
   * the document outlived the run.
   */
  settledMs?: number
  totalMs?: number
}

export interface AgentHandlers {
  onText: (text: string) => void
  onEditStart: (event: {
    id: string
    oldStr: string
    replaceAll: boolean
    elapsedMs: number
    timing: EditTiming
  }) => void
  onEditDelta: (event: { id: string; chunk: string }) => void
  onEditCommit: (event: { id: string; oldStr: string; newStr: string; replaceAll: boolean }) => void
  /** `document` is the working document with any earlier edits from this run already applied. */
  onEditRejected: (event: {
    id: string
    elapsedMs: number
    message: string
    document: string
    oldStr: string
    /** Every place `old_str` did match, so an ambiguous edit can be shown in place. */
    matches: Match[]
  }) => void
  /**
   * The end of a turn that called the tool, with every edit that turn produced
   * already applied to `document`.
   *
   * A path that cannot stream has nothing on screen until something commits it,
   * and the run is not the unit that produced the edit. Committing here puts a
   * whole-node edit in the document in its own turn rather than after however
   * many turns the model spends afterwards.
   */
  onTurnEnd: (event: { document: string }) => void
  onDone: (event: {
    document: string
    /** Wall clock from the first request leaving the browser to the last turn ending. */
    elapsedMs: number
    model: string
    fastMode: boolean
    effort: EffortChoice['id']
    /** The conversation including this run, to carry into the next request. */
    history: ConversationTurn[]
  }) => void
  /** Every wire event, for the inspector. App decisions are recorded by the caller. */
  onEvent: (entry: Omit<TimelineEntry, 'source'> & { source?: 'wire' }) => void
  /** The accumulated tool-input buffer and what the scanner currently reads from it. */
  onBuffer: (state: BufferState) => void
}

export interface RunOptions {
  apiKey: string
  model?: string
  fastMode?: boolean
  effort?: EffortChoice['id']
  /** Include the uniqueness and padding rules in the system prompt. */
  guardrails?: boolean
  /** Declare `old_str` before `new_str` in the tool schema. Custom tool only. */
  oldStrFirst?: boolean
  /** Stream unvalidated tool-input fragments instead of waiting for valid JSON. Custom tool only. */
  eagerStreaming?: boolean
  /** Declare this app's `str_replace` or Anthropic's text editor tool. */
  editorTool?: EditorTool
  document: string
  prompt: string
  /** Earlier turns. Without them the model cannot answer a follow-up or its own question. */
  history?: readonly ConversationTurn[]
  signal?: AbortSignal
  handlers: AgentHandlers
}

/**
 * Anthropic refuses browser-origin requests from organizations that set custom
 * retention. The refusal is readable only when the request itself is what got
 * rejected. A rejected preflight leaves the browser with nothing to report, and
 * the SDK turns that into an `APIConnectionError` whose message says nothing.
 */
const CORS_REFUSAL = /CORS requests are not allowed/i

/** The way out, which is the same whether the refusal was readable or not. */
const CORS_FIX =
  'The macOS desktop build issues requests outside the browser, so it works with this key: https://github.com/bendrucker/anthropic-text-editor-inspector/releases. Running the inspector locally with `bun run dev` also works, since the dev server forwards the request. Your key stays on your own machine either way.'

const CORS_HELP = `This organization does not allow browser requests to the API. ${CORS_FIX}`

/**
 * What a request that never got an answer means, which depends on who was
 * making it. Only `direct` is a browser request, so only it can be refused on
 * origin. The other two fail somewhere the user can go and look.
 */
const CONNECTION_HELP: Record<Transport, string> = {
  direct: `The request never reached the API, and a rejected preflight looks exactly like being offline. If you are online, this organization does not allow browser requests. ${CORS_FIX}`,
  proxy:
    'The request never reached api.anthropic.com. It goes through the dev server, so either that server stopped or it could not reach the API itself. The terminal running `bun run dev` has the real error.',
  tauri:
    'The request failed in Rust, which is what issues it in the desktop build. It sends no origin for the API to refuse, so this is a network, DNS, or TLS failure on this machine.',
}

/** An error body can be a whole HTML gateway page. A clause of it is evidence, the rest is noise. */
const DETAIL_LIMIT = 300

function clip(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').replaceAll('`', "'").trim()
  return collapsed.length > DETAIL_LIMIT ? `${collapsed.slice(0, DETAIL_LIMIT)}…` : collapsed
}

/**
 * What a status means and whether sending it again can change the answer. The
 * SDK has already retried the retryable ones as many times as the client
 * allows, so retryable here means later, by hand.
 */
function statusHelp(status: number): string | undefined {
  if (status === 401) return `That API key was rejected. ${keyStore.change}`
  if (status === 403)
    return 'The API refused this request (403). The key is valid but not permitted to make it, which retrying will not change.'
  if (status === 404)
    return 'The API has no such endpoint or model (404). Retrying will not change that: check the model and the base URL this build points at.'
  if (status === 429) return 'Rate limited (429). Wait a moment and send it again.'
  if (status === 529) return 'The API is overloaded (529). Nothing is wrong with the request, so try again shortly.'
  if (status >= 500) {
    // Through the dev server a 502 or 504 is as likely to be the hop as the API,
    // and only one of the two leaves anything the user can read.
    const hop =
      TRANSPORT === 'proxy'
        ? ' The dev server can also answer with a 5xx of its own, in which case its terminal has the real error.'
        : ''
    return `The API failed on its side (${status}). That is usually transient, so it is worth sending again.${hop}`
  }
  return undefined
}

/**
 * What the API itself said, as a trailing clause. A JSON error body reads as a
 * sentence and is used as one. Anything else is quoted, because a proxy or a
 * gateway can answer a request to the API with a page meant for a human.
 */
function apiDetail(cause: APIError): string | undefined {
  const body = cause.error as { error?: { message?: unknown } } | undefined

  if (body !== undefined) {
    const reported = body.error?.message
    if (typeof reported === 'string' && reported.trim()) return clip(reported)
    return `\`${clip(JSON.stringify(body))}\``
  }

  // A body the SDK could not parse survives only inside the message it built,
  // and that message is also what it says when there was no body to parse.
  if (cause.status === undefined || cause.message === `${cause.status} status code (no body)`) {
    return undefined
  }
  const prefix = `${cause.status} `
  if (!cause.message.startsWith(prefix)) return undefined
  const raw = cause.message.slice(prefix.length)
  return raw.trim() ? `\`${clip(raw)}\`` : undefined
}

export function describeFailure(cause: unknown): string {
  if (cause instanceof APIError) return describeApiError(cause)
  return clip(cause instanceof Error ? cause.message : String(cause))
}

/**
 * The SDK's message is not a description of the failure. Every connection
 * failure it throws carries the literal string `Connection error.`, whatever
 * the browser or Rust actually reported, so the type is what has to be read.
 */
function describeApiError(cause: APIError): string {
  if (cause instanceof APIConnectionTimeoutError) {
    return 'The request timed out before the API answered.'
  }

  if (cause instanceof APIConnectionError) {
    // The browser's own error survives only here, as the cause the SDK wrapped.
    const inner = cause.cause
    const reported = inner instanceof Error ? inner.message : typeof inner === 'string' ? inner : ''
    const evidence = reported ? ` The underlying error was \`${clip(reported)}\`.` : ''
    return `${CONNECTION_HELP[TRANSPORT]}${evidence}`
  }

  const detail = apiDetail(cause)
  if (detail && CORS_REFUSAL.test(detail)) return CORS_HELP

  const help = cause.status === undefined ? undefined : statusHelp(cause.status)
  const sentence = help ?? detail ?? clip(cause.message)
  const evidence = help && detail ? ` The API said: ${detail}` : ''
  // The one detail that makes a report to Anthropic actionable.
  const request = cause.requestID ? ` (request ${cause.requestID})` : ''

  return `${sentence}${evidence}${request}`
}

/**
 * What each transport has to say about itself for the API to answer it.
 *
 * Only `direct` is a browser request, and the API wants one declared. Through
 * the dev server the request stops being a browser request before the API sees
 * it, so it says nothing.
 *
 * The Tauri plugin attaches the webview's own origin to every request Rust
 * issues, `tauri://localhost` packaged and the dev server's URL under `tauri
 * dev`, which is exactly the browser request a custom-retention organization
 * refuses. Its `unsafe-headers` feature, enabled in `src-tauri/Cargo.toml`,
 * makes it drop an `Origin` sent as the empty string instead.
 */
export const TRANSPORT_HEADERS: Record<Transport, Record<string, string>> = {
  direct: { 'anthropic-dangerous-direct-browser-access': 'true' },
  proxy: {},
  tauri: { origin: '' },
}

export function createClient(apiKey: string) {
  return new Anthropic({
    apiKey,
    baseURL: BASE_URL,
    dangerouslyAllowBrowser: true,
    // Rust issues the request and streams the response back over IPC.
    ...(TRANSPORT === 'tauri' ? { fetch: tauriFetch } : {}),
    defaultHeaders: TRANSPORT_HEADERS[TRANSPORT],
  })
}

/**
 * Drops assistant tool calls that never received a result.
 *
 * A turn that stops for any reason other than `tool_use` can still carry a
 * `tool_use` block, which `max_tokens` mid-call is the usual way to produce.
 * The API rejects a later request whose history holds a tool call with no
 * matching result, so keeping one poisons every request that follows.
 */
export function stripDanglingToolUse(turns: readonly ConversationTurn[]): ConversationTurn[] {
  const answered = new Set<string>()

  for (const turn of turns) {
    if (turn.role !== 'user' || typeof turn.content === 'string') continue
    for (const block of turn.content) {
      if (block.type === 'tool_result') answered.add(block.tool_use_id)
    }
  }

  const kept: ConversationTurn[] = []

  for (const turn of turns) {
    if (turn.role !== 'assistant' || typeof turn.content === 'string') {
      kept.push(turn)
      continue
    }

    const content = turn.content.filter(
      (block) => block.type !== 'tool_use' || answered.has(block.id),
    )

    // An assistant turn left with no content at all is itself invalid.
    if (content.length > 0) kept.push({ ...turn, content })
  }

  return kept
}

export async function runEdit(options: RunOptions): Promise<void> {
  const { apiKey, document, prompt, signal, handlers } = options
  const effort = options.effort ?? DEFAULT_EFFORT
  const guardrails = options.guardrails ?? true
  const editorTool = options.editorTool ?? 'custom'
  const builtin = editorTool === 'builtin'
  const oldStrFirst = options.oldStrFirst ?? true
  const eagerStreaming = options.eagerStreaming ?? true
  // Neither switch reaches the built-in tool, so a run that declares it records
  // no setting for them rather than one that did nothing.
  const tool = builtin ? BUILTIN_EDITOR_TOOL : buildTool({ oldStrFirst, eager: eagerStreaming })

  const model = findModel(options.model ?? DEFAULT_MODEL) ?? findModel(DEFAULT_MODEL)!
  // Guard the combinations the API rejects.
  const fastMode = Boolean(options.fastMode) && model.supportsFast

  const client = createClient(apiKey)
  const startedAt = performance.now()
  const since = () => Math.round(performance.now() - startedAt)
  let sequence = 0
  const record = (entry: Omit<TimelineEntry, 'id' | 'atMs' | 'source'>) =>
    handlers.onEvent({ ...entry, id: `wire-${sequence++}`, atMs: since() })
  let workingDocument = document

  const history: ConversationTurn[] = [...(options.history ?? []), { role: 'user', content: prompt }]
  let turnNumber = 0

  for (;;) {
    turnNumber += 1
    const turnStartedAt = since()
    record({
      label: `request sent (turn ${turnNumber})`,
      detail: [
        model.id,
        fastMode ? 'fast' : null,
        model.supportsEffort && effort !== 'auto' ? `effort ${effort}` : null,
        ...(builtin
          ? [BUILTIN_EDITOR_TOOL.type, 'schema server-defined, no streaming control']
          : [
              'custom str_replace',
              oldStrFirst ? 'old_str first' : 'new_str first',
              eagerStreaming ? 'eager streaming' : 'eager streaming off',
            ]),
        guardrails ? null : 'guardrails off',
      ]
        .filter(Boolean)
        .join(', '),
    })

    const turn = client.beta.messages.stream(
      {
        model: model.id,
        max_tokens: 16000,
        system: [
          { type: 'text', text: buildSystem(guardrails, editorTool) },
          { type: 'text', text: `<document>\n${workingDocument}\n</document>` },
        ],
        tools: [tool],
        messages: history,
        ...(model.supportsEffort && effort !== 'auto' ? { output_config: { effort } } : {}),
        ...(fastMode ? { speed: 'fast' as const, betas: ['fast-mode-2026-02-01'] } : {}),
      },
      { signal },
    )

    // Tracks how much of each tool's streamed input has already been forwarded.
    const buffers = new Map<number, string>()
    const announced = new Set<number>()
    const forwarded = new Map<number, number>()
    const blockIds = new Map<number, string>()
    const fragments = new Map<number, number>()
    let firstByteMs: number | null = null
    let toolStartMs: number | null = null

    for await (const event of turn) {
      if (firstByteMs === null) {
        firstByteMs = since()
        record({ label: 'first byte', detail: 'network and model start-up done' })
      }

      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          toolStartMs ??= since()
          buffers.set(event.index, '')
          forwarded.set(event.index, 0)
          fragments.set(event.index, 0)
          blockIds.set(event.index, event.content_block.id)
          record({
            label: `content_block_start · tool_use`,
            detail: builtin
              ? `${event.content_block.name}, eager input streaming unavailable on an Anthropic-defined tool`
              : `${event.content_block.name}, eager input streaming ${eagerStreaming ? 'on' : 'off'}`,
          })
        } else {
          record({ label: `content_block_start · ${event.content_block.type}` })
        }
        continue
      }

      if (event.type === 'content_block_stop') {
        record({ label: 'content_block_stop' })
        continue
      }

      if (event.type !== 'content_block_delta') continue

      if (event.delta.type === 'text_delta') {
        handlers.onText(event.delta.text)
        continue
      }

      if (event.delta.type !== 'input_json_delta') continue

      const index = event.index
      const buffer = (buffers.get(index) ?? '') + event.delta.partial_json
      buffers.set(index, buffer)

      const parsed = scanEditInput(buffer)
      const id = blockIds.get(index) ?? String(index)
      const count = (fragments.get(index) ?? 0) + 1
      fragments.set(index, count)

      record({ label: 'input_json_delta', raw: event.delta.partial_json })

      // The built-in tool multiplexes four commands through one block, and only
      // str_replace describes an edit. A `view` has nothing to open a card for,
      // and its fragments still show up in the timeline above.
      if (builtin && parsed.command !== 'str_replace') continue

      handlers.onBuffer({
        toolUseId: id,
        buffer,
        oldStr: parsed.oldStr,
        oldStrComplete: parsed.oldStrComplete,
        newStr: parsed.newStr,
        newStrComplete: parsed.newStrComplete,
        fragments: count,
      })

      // The target is known as soon as old_str closes, which on a streamed call
      // is well before new_str ends. A single burst closes both at once, and the
      // entry reads the scan rather than assuming which shape this call took.
      if (parsed.oldStrComplete && parsed.oldStr && !announced.has(index)) {
        announced.add(index)
        // This call's own target, not the run's first. A rejected attempt also
        // closes an `old_str`, and the summary reads the timing of whichever
        // edit landed, so a shared reading would describe the wrong turn.
        const targetMs = since()
        record({
          label: 'old_str closed',
          detail: parsed.newStrComplete
            ? `${parsed.oldStr.length} chars. The target and its replacement arrived together.`
            : `${parsed.oldStr.length} chars. The target is known while new_str is still arriving.`,
          tone: 'good',
        })
        handlers.onEditStart({
          id,
          oldStr: parsed.oldStr,
          replaceAll: parsed.replaceAll ?? false,
          elapsedMs: targetMs,
          timing: {
            firstByteMs: firstByteMs ?? targetMs,
            toolStartMs: toolStartMs ?? targetMs,
            targetMs,
            retriesMs: turnStartedAt,
            turn: turnNumber,
            oldStrChars: parsed.oldStr.length,
          },
        })
      }

      if (announced.has(index) && parsed.newStr !== undefined) {
        const already = forwarded.get(index) ?? 0
        if (parsed.newStr.length > already) {
          handlers.onEditDelta({ id, chunk: parsed.newStr.slice(already) })
          forwarded.set(index, parsed.newStr.length)
        }
      }
    }

    const message = await turn.finalMessage()
    record({ label: 'message_delta', detail: `stop_reason: ${message.stop_reason}` })
    history.push({ role: 'assistant', content: message.content })

    if (message.stop_reason !== 'tool_use') {
      handlers.onDone({
        document: workingDocument,
        elapsedMs: since(),
        model: model.id,
        fastMode,
        effort: model.supportsEffort ? effort : 'auto',
        history: stripDanglingToolUse(history),
      })
      return
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []

    for (const block of message.content) {
      if (block.type !== 'tool_use' || block.name !== tool.name) continue

      const input = block.input as {
        command?: string
        path?: string
        old_str?: string
        new_str?: string
        replace_all?: boolean
      }

      // The built-in tool arrives expecting a filesystem. What it gets is one
      // document that can be read and replaced into, and errors for the rest.
      if (builtin) {
        const refusal = !namesDocument(input.path)
          ? `No such file: ${input.path}. The only document open is ${SYNTHETIC_PATH}.`
          : input.command !== 'view' && input.command !== 'str_replace'
            ? `The ${input.command} command is not implemented here. This document is editor state rather than a file, so only view and str_replace apply to it.`
            : null

        if (refusal) {
          record({ label: 'tool_result · is_error', detail: refusal, tone: 'bad' })
          handlers.onEditRejected({
            id: block.id,
            elapsedMs: since(),
            message: refusal,
            document: workingDocument,
            oldStr: '',
            matches: [],
          })
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: refusal,
          })
          continue
        }

        if (input.command === 'view') {
          record({
            label: 'tool_result · view',
            detail:
              'Returned the document. The built-in tool reads a file before it edits one, so the first edit can cost a round trip the custom tool never spends.',
          })
          results.push({ type: 'tool_result', tool_use_id: block.id, content: workingDocument })
          continue
        }
      }

      if (typeof input.old_str !== 'string' || typeof input.new_str !== 'string') {
        record({
          label: 'tool_result · is_error',
          detail: 'Input never became valid JSON. Returned as INVALID_JSON so the model can retry.',
          tone: 'bad',
        })
        handlers.onEditRejected({
          id: block.id,
          elapsedMs: since(),
          message: 'Tool input was incomplete.',
          document: workingDocument,
          oldStr: '',
          matches: [],
        })
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: true,
          content: JSON.stringify({ INVALID_JSON: JSON.stringify(input) }),
        })
        continue
      }

      const located = locateEdit(workingDocument, input.old_str, input.replace_all, !builtin)

      if (!located.ok) {
        record({
          label: 'tool_result · is_error',
          detail: `${located.message} Sent back to the model as the tool result.`,
          tone: 'bad',
        })
        handlers.onEditRejected({
          id: block.id,
          elapsedMs: since(),
          message: located.message,
          document: workingDocument,
          oldStr: input.old_str,
          matches: located.matches,
        })
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: true,
          content: located.message,
        })
        continue
      }

      workingDocument = applyEdit(workingDocument, located.matches, input.new_str)
      handlers.onEditCommit({
        id: block.id,
        oldStr: input.old_str,
        newStr: input.new_str,
        replaceAll: input.replace_all ?? false,
      })
      record({
        label: 'tool_result · ok',
        detail: `Replaced ${located.matches.length} occurrence(s).`,
        tone: 'good',
      })
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Replaced ${located.matches.length} occurrence(s).`,
      })
    }

    // Every edit of this turn is in the working document now, and the next turn
    // is a round trip away. Nothing about the screen has to wait for it.
    handlers.onTurnEnd({ document: workingDocument })

    history.push({ role: 'user', content: results })
  }
}
