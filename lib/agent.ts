import Anthropic from '@anthropic-ai/sdk'
import { locateEdit, applyEdit, type Match } from './str-replace'
import { scanEditInput } from './partial-json'
import { findModel, DEFAULT_MODEL, DEFAULT_EFFORT, type EffortChoice } from './models'
import type { BufferState, TimelineEntry } from './timeline'

/**
 * The edit loop, running in the browser against the user's own key.
 *
 * With no server between the model and the editor, streamed tool input reaches
 * the document as a direct call rather than a re-encoded server event.
 */

const EDIT_RULES = `
Rules for str_replace:
- old_str must reproduce text from the document exactly, including whitespace and punctuation. Table cells are padded so columns align; reproduce that padding.
- old_str must appear exactly once. If the text you want is not unique, extend it with surrounding context until it is. Set replace_all only when every occurrence should change.
- Keep old_str as short as it can be while staying unique.
- Preserve the document's existing voice and formatting conventions.
`

/**
 * Turning the rules off is a teaching control, not a mistake. Pre-teaching the
 * uniqueness and padding constraints means the model rarely trips, which hides
 * the retry loop. Without them it learns the same constraints from tool results,
 * live and visibly.
 */
export function buildSystem(guardrails: boolean): string {
  return `You edit a Markdown document on behalf of the user.

The document is given below. Make the smallest edit that satisfies the request, using the str_replace tool.
${guardrails ? EDIT_RULES : ''}
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
 * Where the wait goes, measured from the request leaving the browser.
 *
 * Each lever is different: `firstByteMs` is network and model start-up,
 * the gap to `toolStartMs` is preamble the model wrote first, and the gap to
 * `targetMs` is `old_str` streaming, which is bounded by how much context the
 * model needed to make the match unique.
 */
export interface EditTiming {
  firstByteMs: number
  toolStartMs: number
  targetMs: number
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
    message: string
    document: string
    oldStr: string
    /** Every place `old_str` did match, so an ambiguous edit can be shown in place. */
    matches: Match[]
  }) => void
  onDone: (event: { document: string; model: string; fastMode: boolean; effort: EffortChoice['id'] }) => void
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
  /** Declare `old_str` before `new_str` in the tool schema. */
  oldStrFirst?: boolean
  /** Stream unvalidated tool-input fragments instead of waiting for valid JSON. */
  eagerStreaming?: boolean
  document: string
  prompt: string
  signal?: AbortSignal
  handlers: AgentHandlers
}

/** The SDK's message for a failed request is the raw response body. */
export function describeFailure(cause: unknown): string {
  if (cause instanceof Anthropic.APIError) {
    if (cause.status === 401) return 'That API key was rejected. Check it in the key control.'
    if (cause.status === 429) return 'Rate limited. Wait a moment and try again.'

    const body = cause.error as { error?: { message?: string } } | undefined
    if (body?.error?.message) return body.error.message
  }

  return cause instanceof Error ? cause.message : String(cause)
}

export function createClient(apiKey: string) {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
  })
}

export async function runEdit(options: RunOptions): Promise<void> {
  const { apiKey, document, prompt, signal, handlers } = options
  const effort = options.effort ?? DEFAULT_EFFORT
  const guardrails = options.guardrails ?? true
  const oldStrFirst = options.oldStrFirst ?? true
  const eagerStreaming = options.eagerStreaming ?? true
  const tool = buildTool({ oldStrFirst, eager: eagerStreaming })

  const model = findModel(options.model ?? DEFAULT_MODEL) ?? findModel(DEFAULT_MODEL)!
  // Guard the combinations the API rejects.
  const fastMode = Boolean(options.fastMode) && model.supportsFast

  const client = createClient(apiKey)
  const startedAt = performance.now()
  const since = () => Math.round(performance.now() - startedAt)
  let sequence = 0
  const record = (entry: Omit<TimelineEntry, 'id' | 'atMs' | 'source'>) =>
    handlers.onEvent({ ...entry, id: `wire-${sequence++}`, atMs: since() })
  let firstEditAt: number | null = null
  let workingDocument = document

  const history: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }]
  let turnNumber = 0

  for (;;) {
    turnNumber += 1
    record({
      label: `request sent (turn ${turnNumber})`,
      detail: [
        model.id,
        fastMode ? 'fast' : null,
        model.supportsEffort && effort !== 'auto' ? `effort ${effort}` : null,
        oldStrFirst ? 'old_str first' : 'new_str first',
        eagerStreaming ? 'eager streaming' : 'eager streaming off',
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
          { type: 'text', text: buildSystem(guardrails) },
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
            detail: `${event.content_block.name}, eager input streaming ${eagerStreaming ? 'on' : 'off'}`,
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
      handlers.onBuffer({
        toolUseId: id,
        buffer,
        oldStr: parsed.oldStr,
        oldStrComplete: parsed.oldStrComplete,
        newStr: parsed.newStr,
        newStrComplete: parsed.newStrComplete,
        fragments: count,
      })

      // The target is known as soon as old_str closes, well before new_str ends.
      if (parsed.oldStrComplete && parsed.oldStr && !announced.has(index)) {
        announced.add(index)
        firstEditAt ??= performance.now()
        const targetMs = Math.round(firstEditAt - startedAt)
        record({
          label: 'old_str closed',
          detail: `${parsed.oldStr.length} chars. The target is known while new_str is still arriving.`,
          tone: 'good',
        })
        handlers.onEditStart({
          id,
          oldStr: parsed.oldStr,
          replaceAll: parsed.replaceAll ?? false,
          elapsedMs: targetMs,
          timing: { firstByteMs: firstByteMs ?? targetMs, toolStartMs: toolStartMs ?? targetMs, targetMs },
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
        model: model.id,
        fastMode,
        effort: model.supportsEffort ? effort : 'auto',
      })
      return
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []

    for (const block of message.content) {
      if (block.type !== 'tool_use' || block.name !== 'str_replace') continue

      const input = block.input as { old_str?: string; new_str?: string; replace_all?: boolean }

      if (typeof input.old_str !== 'string' || typeof input.new_str !== 'string') {
        record({
          label: 'tool_result · is_error',
          detail: 'Input never became valid JSON. Returned as INVALID_JSON so the model can retry.',
          tone: 'bad',
        })
        handlers.onEditRejected({
          id: block.id,
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

      const located = locateEdit(workingDocument, input.old_str, input.replace_all)

      if (!located.ok) {
        record({
          label: 'tool_result · is_error',
          detail: `${located.message} Sent back to the model as the tool result.`,
          tone: 'bad',
        })
        handlers.onEditRejected({
          id: block.id,
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

    history.push({ role: 'user', content: results })
  }
}
