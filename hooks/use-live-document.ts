import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { serialize, parse } from '@/lib/markdown'
import { DEFAULT_DOCUMENT, findDocument, type LibraryDocument } from '@/lib/library'
import { generateDocument } from '@/lib/generate-document'
import { deriveTraps, deriveProbes } from '@/lib/traps'
import { locateEdit } from '@/lib/str-replace'
import { resolveTarget, findTextRanges, type EditTarget } from '@/lib/positions'
import type { Match } from '@/lib/str-replace'
import { streamHighlightKey, type HighlightRange } from '@/lib/stream-highlight'
import { DEFAULT_MODEL, findModel, DEFAULT_EFFORT, type EffortChoice } from '@/lib/models'
import {
  runEdit,
  describeFailure,
  type EditTiming,
  type ConversationTurn,
  type EditorTool,
} from '@/lib/agent'
import type { BufferState, TimelineEntry } from '@/lib/timeline'
import { instrument, dispatch, type RecordedCall } from '@/lib/recording'
import { afterPaint, countPaintFrames, type PaintCounter } from '@/lib/paint'
import type { AgentHandlers } from '@/lib/agent'
import { keyStore } from '@/lib/api-key'

export type ApplyPath = EditTarget['kind']

/**
 * How far a tool call has got.
 *
 * `buffering` and `streaming` are separated because the two waits are not the
 * same. While buffering, the fragments arriving say nothing yet: `old_str` is
 * still growing and no target can be located from a prefix. Once `old_str`
 * closes the target is known and the app has already acted on it, which is the
 * moment the apply path becomes visible.
 */
export type EditStatus = 'buffering' | 'streaming' | 'applied' | 'rejected' | 'incomplete'

export interface EditRecord {
  id: string
  /** What the buffer scanner has read so far, so a prefix is a real prefix. */
  oldStr: string
  oldStrComplete: boolean
  newStr: string
  newStrComplete: boolean
  status: EditStatus
  /** Which apply path ran. A table edit re-pads its column, so it cannot stream. */
  applyPath?: ApplyPath
  message?: string
  /** Set by an undo. The card stays in place, since the turn still happened. */
  reverted?: boolean
  /** Document snapshot from immediately before this edit, for one-click revert. */
  before: string
}

/** A call whose arguments are still entirely unknown. */
function blankEdit(id: string, before: string): EditRecord {
  return {
    id,
    before,
    status: 'buffering',
    oldStr: '',
    oldStrComplete: false,
    newStr: '',
    newStrComplete: false,
  }
}

/**
 * The conversation, in the order it arrived.
 *
 * A tool call is an item of its own because that is where it happened: the API
 * delivers a turn as ordered content blocks, and text before an edit and text
 * after it are separate blocks with the call between them.
 */
export type ConversationItem =
  | { kind: 'prompt'; id: string; text: string }
  | { kind: 'reply'; id: string; text: string }
  | { kind: 'edit'; id: string; edit: EditRecord }

const countOf = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** True once nothing more will arrive for this edit. */
export function isSettled(edit: EditRecord): boolean {
  return edit.status !== 'buffering' && edit.status !== 'streaming'
}

interface StreamState {
  target: EditTarget
  cursor: number
  anchor: number
  /** Set when the first replacement characters are handed to the editor. */
  textPainted: boolean
  /** Resolved a frame later, when those characters are known to be on screen. */
  textPaintedAtMs: number | null
}

/** One completed request, kept so configurations can be compared in a demo. */
export interface Run {
  model: string
  fastMode: boolean
  effort: EffortChoice['id']
  timeToFirstEditMs: number | null
  timing: EditTiming | null
  prompt: string
}

/**
 * The three apply paths, named once.
 *
 * `summary` is why the path was taken and `during` is what that means for the
 * document while the call is still open, which is the whole answer to "why is
 * nothing moving".
 */
export const APPLY_PATHS: Record<ApplyPath, { label: string; summary: string; during: string }> = {
  inline: {
    label: 'streamed inline',
    summary: 'The match sits inside one text block, so characters land in the document as they arrive.',
    during: 'Characters are landing in the document as they arrive.',
  },
  block: {
    label: 'block replaced',
    summary:
      'The match crosses Markdown syntax, so the whole node is replaced on commit. A table edit re-pads its column.',
    during: 'The node is replaced whole on commit, so the document holds still until then.',
  },
  document: {
    label: 'document reparsed',
    summary: 'The match spans blocks, so the document is reparsed on commit.',
    during: 'The document is reparsed on commit, so it holds still until then.',
  },
}

export function useLiveDocument() {
  const editorRef = useRef<Editor | null>(null)
  const streams = useRef(new Map<string, StreamState>())

  const [document, setDocument] = useState<LibraryDocument>(DEFAULT_DOCUMENT)
  const [generated, setGenerated] = useState<LibraryDocument[]>([])
  const [conversation, setConversation] = useState<ConversationItem[]>([])
  const [running, setRunning] = useState(false)
  const [timeToFirstEdit, setTimeToFirstEdit] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [fastMode, setFastMode] = useState(false)
  const [effort, setEffort] = useState<EffortChoice['id']>(DEFAULT_EFFORT)
  const [guardrails, setGuardrails] = useState(true)
  const [oldStrFirst, setOldStrFirst] = useState(true)
  const [eagerStreaming, setEagerStreaming] = useState(true)
  const [editorTool, setEditorTool] = useState<EditorTool>('custom')
  const [runs, setRuns] = useState<Run[]>([])
  const [apiKey, setApiKeyState] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [buffer, setBuffer] = useState<BufferState | null>(null)
  const [replaying, setReplaying] = useState(false)
  const [recorded, setRecorded] = useState(false)
  const history = useRef<ConversationTurn[]>([])
  const recording = useRef<{
    calls: RecordedCall[]
    handlers: AgentHandlers
    snapshot: string
    /** Where the run started. A replay rewinds the conversation here first. */
    promptId: string
  } | null>(null)
  const replayTimers = useRef<number[]>([])
  const abortRef = useRef<AbortController | null>(null)
  /**
   * Paint timestamps share a clock with `performance.now()`, so they need only
   * the run's origin to land on the same axis as the wire events.
   */
  const paintClock = useRef<(at: number) => number>(() => 0)
  const paintFrames = useRef<PaintCounter | null>(null)

  // Read once on mount. The Keychain answers asynchronously, so a stale reply
  // after the user has already typed a key would otherwise overwrite it.
  useEffect(() => {
    let current = true

    async function restoreStoredKey() {
      const stored = await keyStore.read()
      if (current && stored) setApiKeyState(stored)
    }

    void restoreStoredKey()

    return () => {
      current = false
    }
  }, [])

  const setApiKey = useCallback(async (key: string | null) => {
    setApiKeyState(key)
    if (key) await keyStore.write(key)
    else await keyStore.clear()
  }, [])

  // Fast mode is unavailable on most models, so a model change can invalidate it.
  const modelChoice = findModel(model)
  const fastAvailable = modelChoice?.supportsFast ?? false
  const fastEnabled = fastMode && fastAvailable
  const effortAvailable = modelChoice?.supportsEffort ?? false

  const setEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor
  }, [])

  const currentMarkdown = useCallback(() => {
    const editor = editorRef.current
    return editor ? serialize(editor.getJSON()) : ''
  }, [])

  const highlight = useCallback((ranges: HighlightRange | HighlightRange[] | null) => {
    const editor = editorRef.current
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta(streamHighlightKey, ranges))
  }, [])

  /** Paints every place an `old_str` matched, so "matched 4 times" becomes visible. */
  const showMatches = useCallback((matches: Match[]) => {
    const editor = editorRef.current
    if (!editor) return
    if (matches.length === 0) {
      highlight(null)
      return
    }

    const variant = matches.length > 1 ? ('ambiguous' as const) : ('target' as const)
    const canonical = serialize(editor.getJSON())
    const needle = canonical.slice(matches[0].start, matches[0].end)

    // Exact text ranges when the match is plain prose, block ranges when it is not.
    const exact = findTextRanges(editor.state.doc, needle)
    const ranges =
      exact.length === matches.length
        ? exact.map((range) => ({ ...range, variant }))
        : matches
            .map((match) => resolveTarget(editor.state.doc, canonical, match))
            .flatMap((target) =>
              target.kind === 'document' ? [] : [{ from: target.from, to: target.to, variant }],
            )

    if (ranges.length > 0) {
      highlight(ranges)
      editor.commands.scrollIntoView()
    }
  }, [highlight])

  const itemSequence = useRef(0)
  const nextItemId = useCallback(() => `item-${itemSequence.current++}`, [])

  /**
   * Changes one card. `seed` creates it when the call never reached `onBuffer`:
   * a tool block that streams no input fragments at all is rejected on sight,
   * and the rejection would otherwise land on a card nobody made.
   */
  const changeEdit = useCallback((id: string, change: Partial<EditRecord>, seed?: EditRecord) => {
    setConversation((prior) => {
      const known = prior.some((item) => item.kind === 'edit' && item.edit.id === id)
      if (!known) {
        return seed ? [...prior, { kind: 'edit', id, edit: { ...seed, ...change } }] : prior
      }
      return prior.map((item) =>
        item.kind === 'edit' && item.edit.id === id
          ? { ...item, edit: { ...item.edit, ...change } }
          : item,
      )
    })
  }, [])

  /** App decisions, interleaved with wire events so the mapping between them reads. */
  const appSequence = useRef(0)
  const record = useCallback((entry: Omit<TimelineEntry, 'id' | 'source'>) => {
    setTimeline((prior) => [...prior, { ...entry, id: `app-${appSequence.current++}`, source: 'app' }])
  }, [])

  /**
   * Stamps an entry with the moment its change was on screen rather than the
   * moment it was dispatched. The gap between the two is the app's whole claim.
   */
  const recordPaint = useCallback(
    (build: (atMs: number) => Omit<TimelineEntry, 'id' | 'source' | 'atMs'>) => {
      afterPaint((at) => {
        const atMs = paintClock.current(at)
        record({ ...build(atMs), atMs })
      })
    },
    [record],
  )

  /** A paint timestamp as milliseconds into the run, or null when nothing painted. */
  const paintedAt = useCallback(
    (at: number | null | undefined) => (at == null ? null : paintClock.current(at)),
    [],
  )

  /** Opens a hole at the target so replacement characters have somewhere to land. */
  const beginEdit = useCallback(
    (id: string, oldStr: string): EditTarget['kind'] | null => {
      const editor = editorRef.current
      if (!editor) return null

      const canonical = serialize(editor.getJSON())
      const located = locateEdit(canonical, oldStr)
      if (!located.ok) return null

      const target = resolveTarget(editor.state.doc, canonical, located.matches[0])
      if (target.kind !== 'inline') {
        // Structural edits are applied whole on commit. Nothing streams.
        streams.current.set(id, {
          target,
          cursor: 0,
          anchor: 0,
          textPainted: false,
          textPaintedAtMs: null,
        })
        return target.kind
      }

      const { from, to } = target
      editor.view.dispatch(
        editor.state.tr.delete(from, to).setMeta('addToHistory', false).setMeta(streamHighlightKey, {
          from,
          to: from,
          variant: 'writing',
        }),
      )

      paintFrames.current?.touched()
      streams.current.set(id, {
        target,
        cursor: from,
        anchor: from,
        textPainted: false,
        textPaintedAtMs: null,
      })
      editor.commands.scrollIntoView()
      return target.kind
    },
    [],
  )

  const appendChunk = useCallback((id: string, chunk: string) => {
    const editor = editorRef.current
    const stream = streams.current.get(id)
    if (!editor || !stream || stream.target.kind !== 'inline') return

    const at = stream.cursor
    editor.view.dispatch(
      editor.state.tr
        .insertText(chunk, at)
        .setMeta('addToHistory', false)
        .setMeta(streamHighlightKey, { from: stream.anchor, to: at + chunk.length, variant: 'writing' }),
    )
    stream.cursor = at + chunk.length

    paintFrames.current?.touched()
    if (!stream.textPainted) {
      stream.textPainted = true
      afterPaint((at) => {
        // Kept on the stream so the commit can say how long the replacement
        // spent visibly landing, which is the whole case for streaming it.
        stream.textPaintedAtMs = paintClock.current(at)
        record({
          atMs: stream.textPaintedAtMs,
          label: 'paint · first replacement text',
          detail: 'Replacement characters are on screen while new_str is still arriving.',
          tone: 'good',
        })
      })
    }
  }, [record])

  /**
   * Puts the authoritative document on screen and answers whether anything
   * moved. A streamed edit is already showing this text, so its reconcile costs
   * no paint. Every other path changes the document here and counts as one.
   */
  const reconcile = useCallback((document: string): boolean => {
    const editor = editorRef.current
    if (!editor) return false

    const onScreen = serialize(editor.getJSON())
    editor.commands.setContent(parse(document), { emitUpdate: false })
    if (onScreen === document) return false
    paintFrames.current?.touched()
    return true
  }, [])

  /**
   * Reconciles against the server's authoritative document once the edit is
   * validated. Answers whether this commit is the first time the edit was
   * visible, which is true of every path except the one that streamed.
   */
  const commitEdit = useCallback(
    (id: string, document: string): boolean => {
      const editor = editorRef.current
      const stream = streams.current.get(id)
      if (!editor) return false

      if (!stream || stream.target.kind !== 'inline') {
        const moved = reconcile(document)
        highlight(null)
        streams.current.delete(id)
        return Boolean(stream) && moved
      }

      highlight({ from: stream.anchor, to: stream.cursor, variant: 'settled' })
      streams.current.delete(id)
      return false
    },
    [highlight, reconcile],
  )

  // Unblocks the UI right away. The controller stays in `abortRef` so the run's
  // own cleanup still recognizes itself and marks the abandoned tool call.
  const stop = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
    editorRef.current?.setEditable(true)
  }, [])

  const cancelReplay = useCallback(() => {
    for (const timer of replayTimers.current) window.clearTimeout(timer)
    replayTimers.current = []
    setReplaying(false)
  }, [])

  /**
   * Watches a finished run again at a fraction of its speed, through the same
   * handlers. The live path stays untouched, so nothing here can slow a real edit.
   */
  const replay = useCallback(
    (speed = 0.25) => {
      const editor = editorRef.current
      const take = recording.current
      if (!editor || !take || running) return

      cancelReplay()
      setReplaying(true)
      setTimeline([])
      setBuffer(null)

      // A replay paints for real, at a fraction of the original speed. Scaling
      // puts its paints back on the axis the recorded wire events are stamped
      // against, so the two still read as one run.
      const replayOrigin = performance.now()
      paintClock.current = (at) => Math.round((at - replayOrigin) * speed)
      paintFrames.current = countPaintFrames()
      // Rewind the conversation to the prompt this run answered. Replaying into
      // the replies it already produced would append the text a second time.
      setConversation((prior) => {
        const at = prior.findIndex((item) => item.id === take.promptId)
        return at === -1 ? prior : prior.slice(0, at + 1)
      })
      streams.current.clear()
      editor.commands.setContent(parse(take.snapshot), { emitUpdate: false })
      editor.setEditable(false)
      highlight(null)

      const timers = take.calls.map((call) =>
        window.setTimeout(() => dispatch(take.handlers, call), call.atMs / speed),
      )

      const last = take.calls[take.calls.length - 1]
      timers.push(
        window.setTimeout(() => {
          setReplaying(false)
          editor.setEditable(true)
        }, (last?.atMs ?? 0) / speed + 80),
      )

      replayTimers.current = timers
    },
    [running, cancelReplay, highlight],
  )

  const send = useCallback(
    async (prompt: string, selection?: string) => {
      const editor = editorRef.current
      if (!editor || running || !prompt.trim()) return

      if (!apiKey) {
        setError('Add your Anthropic API key to start editing.')
        return
      }

      const snapshot = serialize(editor.getJSON())
      const framed = selection
        ? `Within this exact passage of the document:\n\n${selection}\n\n${prompt}`
        : prompt

      const promptId = nextItemId()

      cancelReplay()
      setError(null)
      setTimeToFirstEdit(null)
      setTimeline([])
      setBuffer(null)
      setRecorded(false)
      setRunning(true)
      setConversation((prior) => [...prior, { kind: 'prompt', id: promptId, text: prompt }])
      editor.setEditable(false)

      const controller = new AbortController()
      abortRef.current = controller
      // Whether this run is still the one the app belongs to. Stop leaves the
      // controller in place, so a stopped run keeps its claim until either a
      // newer prompt or `open` takes it.
      const current = () => abortRef.current === controller

      // Held locally because handlers run before state settles.
      let firstEditMs: number | null = null
      let firstTiming: EditTiming | null = null
      let turnHistory: ConversationTurn[] | null = null
      // Which cards this run put on screen, so its cleanup can settle its own
      // without reaching into a run that started after it.
      const ownEdits = new Set<string>()

      const handlers: AgentHandlers = {
        onEvent(entry) {
          setTimeline((prior) => [...prior, { ...entry, source: 'wire' }])
        },

        /**
         * Creates the card, on the first fragment of the call. Between the tool
         * block opening and `old_str` closing, how much has arrived is the only
         * thing known about the edit, and on the `block` and `document` paths
         * the document itself does not move until commit.
         */
        onBuffer(state) {
          setBuffer(state)
          ownEdits.add(state.toolUseId)
          const scanned = {
            oldStr: state.oldStr ?? '',
            oldStrComplete: state.oldStrComplete,
            newStr: state.newStr ?? '',
            newStrComplete: state.newStrComplete,
          }

          setConversation((prior) => {
            const known = prior.some((item) => item.kind === 'edit' && item.edit.id === state.toolUseId)
            if (known) {
              return prior.map((item) =>
                item.kind === 'edit' && item.edit.id === state.toolUseId
                  ? { ...item, edit: { ...item.edit, ...scanned } }
                  : item,
              )
            }

            return [
              ...prior,
              {
                kind: 'edit',
                id: state.toolUseId,
                edit: { ...blankEdit(state.toolUseId, snapshot), ...scanned },
              },
            ]
          })
        },

        onText(text) {
          setConversation((prior) => {
            const last = prior[prior.length - 1]
            // A tool call between two text blocks starts a new reply, because
            // that is how the turn arrived.
            if (last?.kind !== 'reply') {
              return [...prior, { kind: 'reply', id: nextItemId(), text }]
            }
            return [...prior.slice(0, -1), { ...last, text: last.text + text }]
          })
        },

        onEditStart(event) {
          firstEditMs ??= event.elapsedMs
          firstTiming ??= event.timing
          setTimeToFirstEdit((prior) => prior ?? event.elapsedMs)

          const applyPath = beginEdit(event.id, event.oldStr) ?? undefined
          record({
            atMs: event.elapsedMs,
            label: applyPath ? `target resolved · ${applyPath}` : 'target not found yet',
            detail: applyPath
              ? APPLY_PATHS[applyPath].summary
              : 'No unique match in the current document. The tool result will say so.',
            tone: applyPath ? 'good' : 'bad',
          })

          // Only the inline path moves anything yet. The other two hold the
          // document still until commit, so their first paint is the commit.
          if (applyPath === 'inline') {
            recordPaint((atMs) => ({
              label: 'paint · target opened',
              detail: `The hole is on screen ${atMs - event.elapsedMs}ms after old_str closed, with new_str still arriving.`,
              tone: 'good',
            }))
          }

          changeEdit(event.id, {
            status: 'streaming',
            oldStr: event.oldStr,
            oldStrComplete: true,
            applyPath,
          })
        },

        // The card reads `new_str` off the buffer, which carries the same
        // characters this chunk does. Only the document needs the chunk.
        onEditDelta(event) {
          appendChunk(event.id, event.chunk)
        },

        onEditCommit(event) {
          changeEdit(event.id, {
            status: 'applied',
            oldStr: event.oldStr,
            newStr: event.newStr,
            newStrComplete: true,
          })

          const stream = streams.current.get(event.id)
          if (stream?.target.kind !== 'inline') return
          const openedAt = stream.textPaintedAtMs

          // The commit itself paints nothing on this path, since the characters
          // are already there. The frame the last of them landed in is the
          // settle, so this reads the counter rather than timing its own call.
          afterPaint(() => {
            const atMs = paintedAt(paintFrames.current?.read().lastAtMs)
            if (atMs === null) return
            record({
              atMs,
              label: 'paint · edit settled',
              detail:
                openedAt === null
                  ? `The replacement is on screen at ${atMs}ms.`
                  : `The replacement finished landing ${atMs - openedAt}ms after its first characters appeared.`,
              tone: 'good',
            })
          })
        },

        onEditRejected(event) {
          record({
            atMs: event.elapsedMs,
            label:
              event.matches.length > 1
                ? `ambiguous · ${event.matches.length} matches highlighted`
                : 'document restored',
            detail:
              event.matches.length > 1
                ? 'Every place old_str matched is marked in the document.'
                : 'The hole opened for this edit is closed again.',
            tone: 'bad',
          })
          ownEdits.add(event.id)
          changeEdit(
            event.id,
            {
              status: 'rejected',
              message: event.message,
              // Empty when the input never became valid JSON, where the buffer
              // the scanner already holds is the only account of what arrived.
              ...(event.oldStr ? { oldStr: event.oldStr } : {}),
            },
            blankEdit(event.id, snapshot),
          )
          // Closes the hole opened for the rejected edit. This also lands any
          // earlier edit of the run that never streamed, so what moved on
          // screen decides whether there was a paint, not what was rejected.
          if (reconcile(event.document)) {
            recordPaint(() => ({
              label: 'paint · document restored',
              detail: 'The document is back on screen without the rejected edit.',
              tone: 'bad',
            }))
          }
          streams.current.delete(event.id)
          if (event.matches.length > 1) showMatches(event.matches)
          else highlight(null)
        },

        onDone(event) {
          turnHistory = event.history
          // Several structural edits commit in the same frame, so they are one
          // paint and get one entry rather than a row each.
          let committed = 0
          for (const id of [...streams.current.keys()]) {
            if (commitEdit(id, event.document)) committed += 1
          }
          if (committed > 0) {
            recordPaint((atMs) => ({
              label: 'paint · edit settled',
              detail: `${countOf(committed, 'edit')} replaced whole on commit, so ${atMs}ms is the first moment any of them was visible.`,
              tone: 'good',
            }))
          }

          reconcile(event.document)

          // Read a paint later, so the frames the last streamed characters
          // landed in are counted before the run is summed up.
          afterPaint(() => {
            const painted = paintFrames.current?.read()
            const paintMs = paintedAt(painted?.firstAtMs)
            const settledMs = paintedAt(painted?.lastAtMs)

            // A commit-on-settle path repaints at the very end, so the document
            // can finish changing after the last wire event rather than before.
            const frames = countOf(painted?.frames ?? 0, 'painted frame')
            const tailMs = event.elapsedMs - (settledMs ?? 0)
            record({
              atMs: event.elapsedMs,
              label: 'run complete',
              detail:
                settledMs === null
                  ? `${event.elapsedMs}ms in total, with nothing painted. The document never changed.`
                  : tailMs > 0
                    ? `${event.elapsedMs}ms in total, across ${frames}. The document stopped changing at ${settledMs}ms, so the last ${tailMs}ms bought no visible change.`
                    : `${event.elapsedMs}ms in total, across ${frames}. The document finished changing at ${settledMs}ms, after the run itself had ended.`,
            })

            setRuns((prior) => [
              {
                model: event.model,
                fastMode: event.fastMode,
                effort: event.effort,
                timeToFirstEditMs: firstEditMs,
                timing: firstTiming && {
                  ...firstTiming,
                  ...(paintMs === null ? {} : { paintMs }),
                  ...(settledMs === null ? {} : { settledMs }),
                  totalMs: event.elapsedMs,
                },
                prompt,
              },
              ...prior,
            ])
          })
        },
      }

      const calls: RecordedCall[] = []
      const startedAt = performance.now()
      paintClock.current = (at) => Math.round(at - startedAt)
      paintFrames.current = countPaintFrames()

      try {
        await runEdit({
          apiKey,
          model,
          fastMode: fastEnabled,
          effort,
          guardrails,
          oldStrFirst,
          eagerStreaming,
          editorTool,
          document: snapshot,
          prompt: framed,
          history: history.current,
          signal: controller.signal,
          handlers: instrument(
            handlers,
            (call) => calls.push(call),
            () => performance.now() - startedAt,
          ),
        })
      } catch (cause) {
        if (current() && (cause as Error).name !== 'AbortError') {
          setError(describeFailure(cause))
        }
      } finally {
        // A stop, an error, or a turn that hit max_tokens mid-call leaves a tool
        // call with no result. Its card would otherwise pulse forever. This runs
        // even for a superseded run, because those cards are the ones nothing
        // else will ever settle.
        setConversation((prior) =>
          prior.map((item) =>
            item.kind === 'edit' && ownEdits.has(item.edit.id) && !isSettled(item.edit)
              ? { ...item, edit: { ...item.edit, status: 'incomplete' } }
              : item,
          ),
        )

        // Everything below is one-per-app. Stop lets this run's promise settle
        // on its own, so a newer run can already own the editor and the
        // controller by now, and this cleanup would undo it.
        if (current()) {
          if (turnHistory) history.current = turnHistory
          recording.current = { calls, handlers, snapshot, promptId }
          setRecorded(calls.length > 0)
          setRunning(false)
          abortRef.current = null
          editor.setEditable(true)
        }
      }
    },
    [
      running,
      apiKey,
      nextItemId,
      changeEdit,
      beginEdit,
      appendChunk,
      commitEdit,
      reconcile,
      highlight,
      showMatches,
      record,
      recordPaint,
      paintedAt,
      cancelReplay,
      model,
      fastEnabled,
      effort,
      guardrails,
      oldStrFirst,
      eagerStreaming,
      editorTool,
    ],
  )
  /**
   * Restores the document to the snapshot taken before the edit's run. The card
   * stays and is marked, since the model did make the call.
   */
  const revert = useCallback(
    (edit: EditRecord) => {
      const editor = editorRef.current
      if (!editor) return
      editor.commands.setContent(parse(edit.before), { emitUpdate: false })
      changeEdit(edit.id, { reverted: true })
      highlight(null)
    },
    [changeEdit, highlight],
  )

  /**
   * Loads a document and clears everything that described the previous one. The
   * timeline, buffer, conversation, and recording are all readings of a run
   * against a document that is no longer open, so none of them survive.
   *
   * This is the only place a document swap resets state. Conversation history
   * belongs here too, since a model told about the previous document explains
   * edits to text nobody can see any more.
   */
  const open = useCallback(
    (next: LibraryDocument) => {
      if (running) return

      // A stopped run holds its controller until its promise settles, and its
      // cleanup would write the previous document's recording back over this
      // one. Dropping the controller here is what tells it to stand down.
      abortRef.current?.abort()
      abortRef.current = null

      cancelReplay()
      streams.current.clear()
      recording.current = null
      history.current = []

      setDocument(next)
      setConversation([])
      setRuns([])
      setTimeline([])
      setBuffer(null)
      setRecorded(false)
      setTimeToFirstEdit(null)
      setError(null)

      const editor = editorRef.current
      editor?.commands.setContent(parse(next.markdown), { emitUpdate: false })
      highlight(null)
    },
    [running, cancelReplay, highlight],
  )

  const selectDocument = useCallback(
    (id: string) => {
      const next = findDocument(id) ?? generated.find((entry) => entry.id === id)
      if (next) open(next)
    },
    [generated, open],
  )

  const generate = useCallback(() => {
    const next = generateDocument(Math.floor(Math.random() * 100_000))
    setGenerated((prior) => [...prior, next])
    open(next)
  }, [open])

  /**
   * Traps come from the document rather than from a list beside it, so a
   * generated document gets real ones. `deriveTraps` verifies each against the
   * matcher, and the library's documents are canonical by the roundtrip check.
   */
  const traps = useMemo(() => deriveTraps(document.markdown), [document])

  /** Matcher presets, built from the same document so each rejection is reachable. */
  const probes = useMemo(() => deriveProbes(document.markdown, traps), [document, traps])

  return {
    document,
    generated,
    selectDocument,
    generate,
    traps,
    probes,
    setEditor,
    currentMarkdown,
    conversation,
    running,
    error,
    timeToFirstEdit,
    runs,
    model,
    setModel,
    fastMode: fastEnabled,
    setFastMode,
    fastAvailable,
    timeline,
    buffer,
    showMatches,
    replay,
    replaying,
    recorded,
    effort,
    setEffort,
    effortAvailable,
    guardrails,
    setGuardrails,
    oldStrFirst,
    setOldStrFirst,
    eagerStreaming,
    setEagerStreaming,
    editorTool,
    setEditorTool,
    apiKey,
    setApiKey,
    send,
    stop,
    revert,
  }
}
