import { useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { FileText, Pilcrow, TextCursor } from 'lucide-react'
import {
  APPLY_PATHS,
  isSettled,
  type ApplyPath,
  type ConversationItem,
  type EditRecord,
} from '@/hooks/use-live-document'
import { briefTraps, type Trap } from '@/lib/traps'
import { ExactText } from './ui/exact-text'
import { PulseDot } from './ui/activity'

interface ChatPaneProps {
  /** Edits that read naturally against the open document. */
  prompts: string[]
  traps: Trap[]
  conversation: ConversationItem[]
  running: boolean
  replaying: boolean
  hasKey: boolean
  error: string | null
  onSend: (prompt: string) => void
  onStop: () => void
  onRevert: (edit: EditRecord) => void
}

export function ChatPane({
  prompts,
  traps,
  conversation,
  running,
  replaying,
  hasKey,
  error,
  onSend,
  onStop,
  onRevert,
}: ChatPaneProps) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // The panel's copy is a function of the traps it is about to show, so that a
  // change to what the derivation verifies has to pass through the sentence.
  const briefing = useMemo(() => briefTraps(traps), [traps])

  // A replay drives the same handlers, so it fills the conversation the same way.
  const streaming = running || replaying
  const tail = conversation[conversation.length - 1]

  /**
   * The two waits with nothing on screen to explain them. Before the first byte
   * nothing at all is known. Between a tool result going back and the next turn
   * starting, the run is mid-retry and the conversation looks finished.
   */
  const pending =
    streaming && (!tail || tail.kind === 'prompt' || (tail.kind === 'edit' && isSettled(tail.edit)))

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      // Every fragment grows the tail card, and a smooth scroll restarted a few
      // hundred times never arrives anywhere. Follow instantly while it streams.
      behavior: streaming ? 'auto' : 'smooth',
    })
  }, [conversation, pending, streaming])

  const submit = () => {
    if (!draft.trim() || running || !hasKey) return
    onSend(draft)
    setDraft('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-slate-200 bg-slate-50/60">
      {/* `overflow-y-auto` sets `min-height: 0`, so this region has no floor of
          its own and a short viewport drives it to nothing. The `Pending` card
          that explains a wait is 75px inside 48px of padding, and it is needed
          precisely when the screen is busiest. A basis rather than a
          `min-height` reserves that space where it exists and yields it below
          roughly 640px, where a hard floor would push the composer off-screen. */}
      <div ref={scrollRef} className="flex-[1_1_8rem] space-y-4 overflow-y-auto px-5 py-6">
        {conversation.length === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Ask for a change, or select a passage in the document to edit it directly.
            </p>

            <div className="space-y-2">
              {prompts.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => onSend(suggestion)}
                  disabled={!hasKey}
                  className="block w-full rounded-lg border border-control bg-white px-3 py-2 text-left text-sm text-slate-600 transition hover:border-control-strong hover:text-slate-900 disabled:opacity-40 disabled:hover:border-control"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {traps.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium tracking-wide text-amber-700 uppercase">
                  Ambiguous targets
                </p>
                <p className="text-xs leading-relaxed text-slate-500">{briefing.guarantee}</p>
                <p className="text-xs leading-relaxed text-slate-500">
                  The model rarely sends it bare. Watch the console for which way out it takes.
                </p>
                <ul className="space-y-1">
                  {briefing.routes.map((route) => (
                    <li key={route.name} className="text-xs leading-relaxed text-slate-500">
                      <span className="font-medium text-slate-600">{route.name}.</span>{' '}
                      {route.detail}
                    </li>
                  ))}
                </ul>
                {traps.map((trap) => (
                  <button
                    key={trap.needle}
                    onClick={() => onSend(trap.prompt)}
                    disabled={!hasKey}
                    className="block w-full rounded-lg border border-control-warn bg-amber-50/60 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-control-warn-strong disabled:opacity-40 disabled:hover:border-control-warn"
                  >
                    {trap.prompt}
                    <span className="mt-0.5 block text-[11px] text-amber-700">{trap.why}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {conversation.map((item) => {
          if (item.kind === 'prompt') {
            return (
              <div
                key={item.id}
                className="ml-6 rounded-2xl rounded-br-sm bg-slate-900 px-4 py-2.5 text-sm text-white"
              >
                {item.text}
              </div>
            )
          }

          if (item.kind === 'reply') {
            return (
              <div key={item.id} className="prose prose-sm prose-slate max-w-none text-slate-700">
                <Streamdown>{item.text}</Streamdown>
              </div>
            )
          }

          return <EditCard key={item.id} edit={item.edit} onRevert={onRevert} />
        })}

        {pending && <Pending afterEdit={tail?.kind === 'edit'} replaying={replaying} />}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            rows={2}
            disabled={!hasKey}
            placeholder={hasKey ? 'Ask for an edit…' : 'Add your API key to start'}
            className="flex-1 resize-none rounded-lg border border-control px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:border-control-strong focus-ring"
          />
          {running ? (
            <button
              onClick={onStop}
              className="rounded-lg border border-control px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!draft.trim() || !hasKey}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-30"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Pending({ afterEdit, replaying }: { afterEdit: boolean; replaying: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs">
      <span className="mt-1">
        <PulseDot />
      </span>
      <span className="min-w-0">
        <span className="font-medium text-slate-600">
          {afterEdit ? 'Tool result sent back' : 'Request sent'}
          {replaying && <span className="ml-1.5 font-normal text-slate-500">replaying</span>}
        </span>
        <span className="mt-0.5 block leading-relaxed text-slate-600">
          {afterEdit
            ? 'The model reads the result and takes another turn. Nothing streams until it does.'
            : 'Waiting for the first byte. Nothing about the edit is known yet.'}
        </span>
      </span>
    </div>
  )
}

const STATUS_TONES: Record<EditRecord['status'], string> = {
  buffering: 'border-blue-200 bg-blue-50/60',
  streaming: 'border-blue-200 bg-blue-50',
  applied: 'border-slate-200 bg-white',
  rejected: 'border-amber-200 bg-amber-50',
  incomplete: 'border-slate-200 bg-slate-50',
}

const STATUS_LABELS: Record<EditRecord['status'], string> = {
  buffering: 'Locating the edit',
  streaming: 'Replacing text',
  applied: 'Edited',
  rejected: 'Rejected, retrying',
  incomplete: 'Never finished',
}

/**
 * One tool call, in the place it happened.
 *
 * `old_str` and `new_str` appear as the matcher will read them, with whichever
 * one is still open marked as such. The raw buffer, the fragment payloads, and
 * the event timings belong to the run inspector.
 */
function EditCard({ edit, onRevert }: { edit: EditRecord; onRevert: (edit: EditRecord) => void }) {
  const path = edit.applyPath ? APPLY_PATHS[edit.applyPath] : null
  const live = !isSettled(edit)

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs ${STATUS_TONES[edit.status]} ${edit.reverted ? 'opacity-60' : ''}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {live && <PulseDot />}
          <span className="font-mono text-[11px] text-slate-600">str_replace</span>
          {/* The status label is the whole life of a tool call in four words. It
              settles a handful of times per call, so announcing it tells a
              reader an edit landed or was rejected without narrating the stream. */}
          <span role="status" className="truncate font-medium text-slate-600">
            {edit.reverted ? 'Reverted' : STATUS_LABELS[edit.status]}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {edit.applyPath && <ApplyPathBadge path={edit.applyPath} />}
          {edit.status === 'applied' && !edit.reverted && (
            <button
              onClick={() => onRevert(edit)}
              className="text-slate-500 underline-offset-2 transition hover:text-slate-700 hover:underline"
            >
              Undo
            </button>
          )}
        </span>
      </div>

      {edit.status === 'rejected' ? (
        <div className="space-y-2">
          <div>
            <p className="mb-1 text-[11px] text-amber-700">old_str the model sent</p>
            {edit.oldStr ? (
              <ExactText text={edit.oldStr} className="text-amber-900" />
            ) : (
              <p className="text-[11px] text-amber-700">
                Nothing the scanner could read. The input never became valid JSON.
              </p>
            )}
          </div>
          <p className="leading-relaxed text-amber-800">{edit.message}</p>
          <p className="text-[11px] text-amber-700">
            Returned to the model as the tool result. It gets to try again.
          </p>
        </div>
      ) : live ? (
        <div className="space-y-2">
          <Field name="old_str" value={edit.oldStr} complete={edit.oldStrComplete} className="text-slate-700" />
          <Field
            name="new_str"
            value={edit.newStr}
            complete={edit.newStrComplete}
            className="text-emerald-700"
          />
          <p className="leading-relaxed text-slate-600">
            {edit.status === 'buffering' ? (
              <>
                Nothing can be located from a prefix of{' '}
                <span className="font-mono">old_str</span>, so the document holds still until it
                closes. Which field arrives first is the schema's key order.
              </>
            ) : (
              (path?.during ??
                'No unique match in the document this app holds, so nothing streams. Either the tool result says so and the model retries, or an earlier structural edit in this run lands first and the match succeeds on commit.')
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {edit.oldStr && (
            <ExactText text={edit.oldStr} className="text-red-700/80 line-through decoration-red-300" />
          )}
          {edit.newStr && <ExactText text={edit.newStr} className="text-emerald-700" />}
          {edit.status === 'incomplete' && (
            <p className="text-[11px] text-slate-600">
              The turn ended before this call produced a result, so nothing was applied.
            </p>
          )}
          {edit.status === 'applied' && (
            <p className="pt-0.5 text-[11px] leading-relaxed text-slate-600">
              {path?.summary ??
                'Applied on commit. This app could not locate the target while the call was open, so which path ran is unknown.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** One tool argument as the buffer scanner currently reads it. */
function Field({
  name,
  value,
  complete,
  className,
}: {
  name: string
  value: string
  complete: boolean
  className: string
}) {
  const state = complete ? 'closed' : value ? 'streaming' : 'not started'

  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-[11px]">
        <span className="font-mono text-slate-600">{name}</span>
        <span className={complete ? 'text-emerald-700' : value ? 'text-blue-600' : 'text-slate-600'}>
          {state}
        </span>
        {value && <span className="tabular-nums text-slate-600">{value.length} chars</span>}
      </p>
      {(value || complete) && <ExactText text={value} className={className} caret={!complete} />}
    </div>
  )
}

const PATH_ICONS: Record<ApplyPath, typeof TextCursor> = {
  inline: TextCursor,
  block: Pilcrow,
  document: FileText,
}

/**
 * Which of the three mechanisms ran. The explanation sits next to the badge
 * rather than in a `title`, which a touch device never shows.
 */
function ApplyPathBadge({ path }: { path: ApplyPath }) {
  const Icon = PATH_ICONS[path]

  return (
    <span className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
      <Icon className="size-2.5" />
      {APPLY_PATHS[path].label}
    </span>
  )
}
