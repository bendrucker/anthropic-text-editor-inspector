import { useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import type { ChatMessage, EditRecord, Run } from '@/hooks/use-live-document'
import type { Trap } from '@/lib/traps'
import { ExactText } from './ui/exact-text'
import { RunHistory } from './run-controls'

interface ChatPaneProps {
  /** Edits that read naturally against the open document. */
  prompts: string[]
  traps: Trap[]
  messages: ChatMessage[]
  edits: EditRecord[]
  runs: Run[]
  running: boolean
  hasKey: boolean
  error: string | null
  onSend: (prompt: string) => void
  onStop: () => void
  onRevert: (edit: EditRecord) => void
}

export function ChatPane({
  prompts,
  traps,
  messages,
  edits,
  runs,
  running,
  hasKey,
  error,
  onSend,
  onStop,
  onRevert,
}: ChatPaneProps) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, edits])

  const submit = () => {
    if (!draft.trim() || running || !hasKey) return
    onSend(draft)
    setDraft('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-slate-200 bg-slate-50/60">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
        {messages.length === 0 && (
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
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-40 disabled:hover:border-slate-200"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {traps.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium tracking-wide text-amber-700 uppercase">
                  Ambiguity traps
                </p>
                <p className="text-xs leading-relaxed text-slate-500">
                  Found by scanning this document for repeated strings, then checked against the
                  matcher. Each names something appearing more than once, so the first{' '}
                  <span className="font-mono">old_str</span> the model tries is ambiguous and gets
                  rejected. Turn off prompt rules first to watch it learn the constraint from the
                  tool result.
                </p>
                {traps.map((trap) => (
                  <button
                    key={trap.needle}
                    onClick={() => onSend(trap.prompt)}
                    disabled={!hasKey}
                    className="block w-full rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-amber-300 disabled:opacity-40 disabled:hover:border-amber-200"
                  >
                    {trap.prompt}
                    <span className="mt-0.5 block text-[11px] text-amber-700">{trap.why}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index}>
            {message.role === 'user' ? (
              <div className="ml-6 rounded-2xl rounded-br-sm bg-slate-900 px-4 py-2.5 text-sm text-white">
                {message.text}
              </div>
            ) : (
              message.text && (
                <div className="prose prose-sm prose-slate max-w-none text-slate-700">
                  <Streamdown>{message.text}</Streamdown>
                </div>
              )
            )}
          </div>
        ))}

        {edits.map((edit) => (
          <EditCard key={edit.id} edit={edit} onRevert={onRevert} />
        ))}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <RunHistory runs={runs} />

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
            className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
          />
          {running ? (
            <button
              onClick={onStop}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
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

function EditCard({ edit, onRevert }: { edit: EditRecord; onRevert: (edit: EditRecord) => void }) {
  const tone =
    edit.status === 'rejected'
      ? 'border-amber-200 bg-amber-50'
      : edit.status === 'streaming'
        ? 'border-blue-200 bg-blue-50'
        : 'border-slate-200 bg-white'

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs ${tone}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-medium text-slate-500">
          {edit.status === 'streaming' && 'Editing…'}
          {edit.status === 'applied' && 'Edited'}
          {edit.status === 'rejected' && 'Rejected, retrying'}
        </span>
        <div className="flex items-center gap-2">
          {edit.applyPath && <ApplyPathBadge path={edit.applyPath} />}
          {edit.status === 'applied' && (
            <button
              onClick={() => onRevert(edit)}
              className="text-slate-400 underline-offset-2 transition hover:text-slate-700 hover:underline"
            >
              Undo
            </button>
          )}
        </div>
      </div>

      {edit.status === 'rejected' ? (
        <div className="space-y-2">
          <div>
            <p className="mb-1 text-[11px] text-amber-700/70">old_str the model sent</p>
            <ExactText text={edit.oldStr} className="text-amber-900" />
          </div>
          <p className="leading-relaxed text-amber-800">{edit.message}</p>
          <p className="text-[11px] text-amber-700/70">
            Returned to the model as the tool result. It gets to try again.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <ExactText text={edit.oldStr} className="text-red-700/80 line-through decoration-red-300" />
          <ExactText text={edit.newStr} className="text-emerald-700" />
        </div>
      )}
    </div>
  )
}

const APPLY_PATH_NOTES: Record<string, { label: string; title: string }> = {
  inline: {
    label: 'streamed inline',
    title: 'The match sits inside one text block, so characters land as they arrive.',
  },
  block: {
    label: 'applied as block',
    title: 'The match crosses Markdown syntax, so the whole node is replaced on commit. A table edit re-pads its column.',
  },
  document: {
    label: 'applied whole',
    title: 'The match spans multiple blocks, so the document is reparsed on commit.',
  },
}

function ApplyPathBadge({ path }: { path: string }) {
  const note = APPLY_PATH_NOTES[path]
  if (!note) return null

  return (
    <span
      title={note.title}
      className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
    >
      {note.label}
    </span>
  )
}
