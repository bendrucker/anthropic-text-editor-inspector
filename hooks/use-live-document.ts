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
import { runEdit, describeFailure, type EditTiming, type ConversationTurn } from '@/lib/agent'
import type { BufferState, TimelineEntry } from '@/lib/timeline'
import { instrument, dispatch, type RecordedCall } from '@/lib/recording'
import type { AgentHandlers } from '@/lib/agent'
import { browserKeyStore } from '@/lib/api-key'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface EditRecord {
  id: string
  oldStr: string
  newStr: string
  status: 'streaming' | 'applied' | 'rejected'
  /** Which apply path ran. A table edit re-pads its column, so it cannot stream. */
  applyPath?: EditTarget['kind']
  message?: string
  /** Document snapshot from immediately before this edit, for one-click revert. */
  before: string
}

interface StreamState {
  target: EditTarget
  cursor: number
  anchor: number
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

const APPLY_PATH_DETAIL: Record<string, string> = {
  inline: 'The match sits inside one text block, so characters stream in as they arrive.',
  block: 'The match crosses Markdown syntax, so the node is replaced whole on commit.',
  document: 'The match spans blocks, so the document is reparsed on commit.',
}

export function useLiveDocument() {
  const editorRef = useRef<Editor | null>(null)
  const streams = useRef(new Map<string, StreamState>())

  const [document, setDocument] = useState<LibraryDocument>(DEFAULT_DOCUMENT)
  const [generated, setGenerated] = useState<LibraryDocument[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [edits, setEdits] = useState<EditRecord[]>([])
  const [running, setRunning] = useState(false)
  const [timeToFirstEdit, setTimeToFirstEdit] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [fastMode, setFastMode] = useState(false)
  const [effort, setEffort] = useState<EffortChoice['id']>(DEFAULT_EFFORT)
  const [guardrails, setGuardrails] = useState(true)
  const [oldStrFirst, setOldStrFirst] = useState(true)
  const [eagerStreaming, setEagerStreaming] = useState(true)
  const [runs, setRuns] = useState<Run[]>([])
  const [apiKey, setApiKeyState] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [buffer, setBuffer] = useState<BufferState | null>(null)
  const [replaying, setReplaying] = useState(false)
  const [recorded, setRecorded] = useState(false)
  const conversation = useRef<ConversationTurn[]>([])
  const recording = useRef<{ calls: RecordedCall[]; handlers: AgentHandlers; snapshot: string } | null>(null)
  const replayTimers = useRef<number[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // Read once on mount so server-side rendering and hydration cannot disagree.
  useEffect(() => {
    setApiKeyState(browserKeyStore.read())
  }, [])

  const setApiKey = useCallback((key: string | null) => {
    if (key) browserKeyStore.write(key)
    else browserKeyStore.clear()
    setApiKeyState(key)
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

  /** App decisions, interleaved with wire events so the mapping between them reads. */
  const appSequence = useRef(0)
  const record = useCallback((entry: Omit<TimelineEntry, 'id' | 'source'>) => {
    setTimeline((prior) => [...prior, { ...entry, id: `app-${appSequence.current++}`, source: 'app' }])
  }, [])

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
        streams.current.set(id, { target, cursor: 0, anchor: 0 })
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

      streams.current.set(id, { target, cursor: from, anchor: from })
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
  }, [])

  /** Reconciles against the server's authoritative document once the edit is validated. */
  const commitEdit = useCallback((id: string, document: string) => {
    const editor = editorRef.current
    const stream = streams.current.get(id)
    if (!editor) return

    if (!stream || stream.target.kind !== 'inline') {
      editor.commands.setContent(parse(document), { emitUpdate: false })
      highlight(null)
      streams.current.delete(id)
      return
    }

    highlight({ from: stream.anchor, to: stream.cursor, variant: 'settled' })
    streams.current.delete(id)
  }, [highlight])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
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
      setEdits([])
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

      cancelReplay()
      setError(null)
      setTimeToFirstEdit(null)
      setTimeline([])
      setBuffer(null)
      setRecorded(false)
      setRunning(true)
      setMessages((prior) => [...prior, { role: 'user', text: prompt }, { role: 'assistant', text: '' }])
      editor.setEditable(false)

      const controller = new AbortController()
      abortRef.current = controller

      // Held locally because handlers run before state settles.
      let firstEditMs: number | null = null
      let firstTiming: EditTiming | null = null
      let turnHistory: ConversationTurn[] | null = null

      const handlers: AgentHandlers = {
        onEvent(entry) {
          setTimeline((prior) => [...prior, { ...entry, source: 'wire' }])
        },

        onBuffer(state) {
          setBuffer(state)
        },

        onText(text) {
          setMessages((prior) => {
            const next = [...prior]
            next[next.length - 1] = {
              role: 'assistant',
              text: next[next.length - 1].text + text,
            }
            return next
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
              ? APPLY_PATH_DETAIL[applyPath]
              : 'No unique match in the current document. The tool result will say so.',
            tone: applyPath ? 'good' : 'bad',
          })

          setEdits((prior) => [
            ...prior,
            {
              id: event.id,
              oldStr: event.oldStr,
              newStr: '',
              status: 'streaming',
              applyPath,
              before: snapshot,
            },
          ])
        },

        onEditDelta(event) {
          setEdits((prior) =>
            prior.map((edit) =>
              edit.id === event.id ? { ...edit, newStr: edit.newStr + event.chunk } : edit,
            ),
          )
          appendChunk(event.id, event.chunk)
        },

        onEditCommit(event) {
          setEdits((prior) =>
            prior.map((edit) =>
              edit.id === event.id ? { ...edit, status: 'applied', newStr: event.newStr } : edit,
            ),
          )
        },

        onEditRejected(event) {
          record({
            atMs: 0,
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
          setEdits((prior) =>
            prior.map((edit) =>
              edit.id === event.id ? { ...edit, status: 'rejected', message: event.message } : edit,
            ),
          )
          // The hole opened for a rejected edit has to be closed again.
          editor.commands.setContent(parse(event.document), { emitUpdate: false })
          streams.current.delete(event.id)
          if (event.matches.length > 1) showMatches(event.matches)
          else highlight(null)
        },

        onDone(event) {
          turnHistory = event.history
          for (const id of [...streams.current.keys()]) commitEdit(id, event.document)
          editor.commands.setContent(parse(event.document), { emitUpdate: false })
          setRuns((prior) => [
            {
              model: event.model,
              fastMode: event.fastMode,
              effort: event.effort,
              timeToFirstEditMs: firstEditMs,
              timing: firstTiming,
              prompt,
            },
            ...prior,
          ])
        },
      }

      const calls: RecordedCall[] = []
      const startedAt = performance.now()

      try {
        await runEdit({
          apiKey,
          model,
          fastMode: fastEnabled,
          effort,
          guardrails,
          oldStrFirst,
          eagerStreaming,
          document: snapshot,
          prompt: framed,
          history: conversation.current,
          signal: controller.signal,
          handlers: instrument(
            handlers,
            (call) => calls.push(call),
            () => performance.now() - startedAt,
          ),
        })
      } catch (cause) {
        if ((cause as Error).name !== 'AbortError') {
          setError(describeFailure(cause))
        }
      } finally {
        if (turnHistory) conversation.current = turnHistory
        recording.current = { calls, handlers, snapshot }
        setRecorded(calls.length > 0)
        setRunning(false)
        abortRef.current = null
        editor.setEditable(true)
      }
    },
    [
      running,
      apiKey,
      beginEdit,
      appendChunk,
      commitEdit,
      highlight,
      showMatches,
      record,
      cancelReplay,
      model,
      fastEnabled,
      effort,
      guardrails,
      oldStrFirst,
      eagerStreaming,
    ],
  )
  const revert = useCallback((edit: EditRecord) => {
    const editor = editorRef.current
    if (!editor) return
    editor.commands.setContent(parse(edit.before), { emitUpdate: false })
    setEdits((prior) => prior.filter((entry) => entry.id !== edit.id))
    highlight(null)
  }, [highlight])

  /**
   * Loads a document and clears everything that described the previous one. The
   * timeline, buffer, edits, and recording are all readings of a run against a
   * document that is no longer open, so none of them survive the switch.
   *
   * This is the only place a document swap resets state. Conversation history
   * belongs here too, since a model told about the previous document explains
   * edits to text nobody can see any more.
   */
  const open = useCallback(
    (next: LibraryDocument) => {
      if (running) return

      cancelReplay()
      streams.current.clear()
      recording.current = null
      conversation.current = []

      setDocument(next)
      setMessages([])
      setEdits([])
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
    messages,
    edits,
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
    apiKey,
    setApiKey,
    send,
    stop,
    revert,
  }
}
