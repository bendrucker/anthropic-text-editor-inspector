import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ChevronDown, ChevronRight } from 'lucide-react'
import type { TimelineEntry, TimelineSource } from '@/lib/timeline'

interface EventConsoleProps {
  timeline: TimelineEntry[]
}

/**
 * The run as a console: one line per event, columns that hold their position
 * down the whole list, and a body you open on the rows that carry one.
 *
 * Order is arrival order and nothing re-sorts it. Wire events and app decisions
 * are two interleaved streams, and the interleaving is what the panel exists to
 * show, so every control here removes rows rather than moving them.
 */
export function EventConsole({ timeline }: EventConsoleProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  // A console follows the tail until you scroll away from it, and picks the
  // tail up again when you come back. Yanking a list someone is reading is
  // worse than losing sight of the newest row.
  useEffect(() => {
    const view = scrollRef.current
    if (following && view) view.scrollTo({ top: view.scrollHeight })
  }, [timeline, following])

  const toggle = (id: string) =>
    setExpanded((prior) => {
      const next = new Set(prior)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <div className="relative flex min-h-0 flex-col">
      <ColumnHeader />

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const view = event.currentTarget
          setFollowing(view.scrollHeight - view.scrollTop - view.clientHeight < 24)
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-1"
      >
        {timeline.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            Ask for an edit. Every event that crosses the wire lands here.
          </p>
        ) : (
          <ol>
            {timeline.map((entry, index) => (
              <EventRow
                key={entry.id}
                entry={entry}
                gapMs={entry.atMs - (timeline[index - 1]?.atMs ?? 0)}
                expanded={expanded.has(entry.id)}
                onToggle={() => toggle(entry.id)}
              />
            ))}
          </ol>
        )}
      </div>

      {!following && timeline.length > 0 && (
        <button
          onClick={() => setFollowing(true)}
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-300 bg-white/95 px-2.5 py-1 text-[10px] font-medium text-slate-600 shadow-sm transition hover:border-slate-400"
        >
          <ArrowDown className="size-3" />
          Follow the tail
        </button>
      )}
    </div>
  )
}

/** Four columns, shared by the header and every row, so nothing drifts. */
const COLUMNS = 'grid grid-cols-[3.25rem_2.25rem_10.5rem_minmax(0,1fr)] items-baseline gap-x-2'

function ColumnHeader() {
  return (
    <div
      className={`${COLUMNS} shrink-0 border-b border-slate-200 px-3 py-1 text-[9px] font-medium tracking-wide text-slate-400 uppercase`}
    >
      <span className="text-right">Time</span>
      <span>Src</span>
      <span className="pl-4">Event</span>
      <span>Detail</span>
    </div>
  )
}

const TONES: Record<string, string> = {
  good: 'text-emerald-700',
  bad: 'text-amber-700',
  normal: 'text-slate-700',
}

const SOURCE_TITLE: Record<TimelineSource, string> = {
  wire: 'Arrived on the wire',
  app: 'A decision this app made',
}

/**
 * Labels read `content_block_start · tool_use`: the event name, then what that
 * instance of it carried. Splitting them is what lets the name column line up.
 */
function splitLabel(label: string): { name: string; qualifier?: string } {
  const at = label.indexOf(' · ')
  if (at === -1) return { name: label }
  return { name: label.slice(0, at), qualifier: label.slice(at + 3) }
}

function EventRow({
  entry,
  gapMs,
  expanded,
  onToggle,
}: {
  entry: TimelineEntry
  gapMs: number
  expanded: boolean
  onToggle: () => void
}) {
  const { name, qualifier } = splitLabel(entry.label)
  const wire = entry.source === 'wire'
  const openable = entry.detail !== undefined || entry.raw !== undefined

  return (
    <li
      className={`border-b border-slate-100 text-[11px] leading-relaxed last:border-b-0 ${
        entry.tone === 'bad' ? 'bg-amber-50/60' : ''
      }`}
    >
      <div
        role={openable ? 'button' : undefined}
        tabIndex={openable ? 0 : undefined}
        onClick={openable ? onToggle : undefined}
        onKeyDown={(event) => {
          if (!openable) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
        className={`${COLUMNS} py-0.5 ${openable ? 'cursor-pointer hover:bg-slate-100/70' : ''}`}
      >
        <span className="text-right tabular-nums text-slate-400" title={`${gapMs.toFixed(0)}ms after the previous event`}>
          {(entry.atMs / 1000).toFixed(2)}s
        </span>

        <span className={`font-medium ${wire ? 'text-blue-500' : 'text-slate-400'}`} title={SOURCE_TITLE[entry.source]}>
          {entry.source}
        </span>

        <span className="flex min-w-0 items-baseline gap-1">
          <span className="w-3 shrink-0 text-slate-300">
            {openable &&
              (expanded ? (
                <ChevronDown className="size-3 translate-y-0.5" />
              ) : (
                <ChevronRight className="size-3 translate-y-0.5" />
              ))}
          </span>
          <span className={`truncate font-mono ${TONES[entry.tone ?? 'normal']}`} title={name}>
            {name}
          </span>
        </span>

        <span className="flex min-w-0 items-baseline gap-2 truncate">
          {qualifier && <span className="shrink-0 font-mono text-slate-500">{qualifier}</span>}
          {entry.raw !== undefined && (
            <span className="shrink-0 rounded bg-white px-1 font-mono text-slate-500">
              {JSON.stringify(entry.raw)}
            </span>
          )}
          {entry.detail && <span className="truncate text-slate-400">{entry.detail}</span>}
        </span>
      </div>

      {expanded && (
        <div className="mb-1 ml-[7.75rem] space-y-1.5 border-l-2 border-slate-200 pl-3">
          {entry.raw !== undefined && (
            <div>
              <p className="text-[10px] font-medium text-slate-500">
                Raw fragment · {entry.raw.length} chars
              </p>
              <pre className="mt-0.5 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-slate-600">
                {JSON.stringify(entry.raw)}
              </pre>
            </div>
          )}
          {entry.detail && <p className="text-[10px] leading-relaxed text-slate-500">{entry.detail}</p>}
        </div>
      )}
    </li>
  )
}
