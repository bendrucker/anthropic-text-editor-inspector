import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ChevronDown, ChevronRight, Search, Settings2, X } from 'lucide-react'
import { Popover, PopoverCheck, PopoverContent, PopoverTrigger } from './ui/popover'
import type { TimelineEntry, TimelineSource } from '@/lib/timeline'

interface EventConsoleProps {
  timeline: TimelineEntry[]
}

const SOURCES: TimelineSource[] = ['wire', 'app']

/**
 * Order is arrival order and nothing re-sorts it. Wire events and app decisions
 * are two interleaved streams, and the interleaving is what the panel exists to
 * show, so every control here removes rows or folds neighbours together. None
 * of them moves a row past another.
 */
export function EventConsole({ timeline }: EventConsoleProps) {
  const [query, setQuery] = useState('')
  const [mutedSources, setMutedSources] = useState<ReadonlySet<TimelineSource>>(new Set())
  const [mutedNames, setMutedNames] = useState<ReadonlySet<string>>(new Set())
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [foldRepeats, setFoldRepeats] = useState(false)
  const [showGaps, setShowGaps] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  // A run only ever appends, so a different entry at the head means a new run, a
  // replay, or another document. Whatever the reader had scrolled away to read
  // is gone, and the ids restart, so anything they had opened would reopen on an
  // unrelated row.
  const [lead, setLead] = useState(timeline[0])
  if (timeline[0] !== lead) {
    setLead(timeline[0])
    setFollowing(true)
    setExpanded(new Set())
  }

  const census = useMemo(() => tally(timeline), [timeline])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const kept = timeline.filter((entry) => {
      if (mutedSources.has(entry.source)) return false
      if (mutedNames.has(splitLabel(entry.label).name)) return false
      if (problemsOnly && entry.tone !== 'bad') return false
      return needle === '' || haystack(entry).includes(needle)
    })

    // Timings come off the full timeline, so a filtered row still reports the
    // wait that actually preceded it.
    const stamps = new Map<string, Stamp>()
    for (const [index, entry] of timeline.entries()) {
      stamps.set(entry.id, {
        index,
        atMs: entry.atMs,
        gapMs: entry.atMs - (timeline[index - 1]?.atMs ?? 0),
        stamped: index === 0 || entry.atMs > 0,
      })
    }

    return foldRepeats ? fold(kept, stamps) : kept.map((entry) => single(entry, stamps))
  }, [timeline, query, mutedSources, mutedNames, problemsOnly, foldRepeats])

  const shown = rows.reduce((count, row) => count + (row.kind === 'group' ? row.entries.length : 1), 0)
  const filtered = shown !== timeline.length

  // A console follows the tail until you scroll away from it, and picks the
  // tail up again when you come back. Yanking a list someone is reading is
  // worse than losing sight of the newest row.
  useEffect(() => {
    const view = scrollRef.current
    if (following && view) view.scrollTo({ top: view.scrollHeight })
  }, [rows, following])

  const toggle = (id: string) =>
    setExpanded((prior) => {
      const next = new Set(prior)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const clearFilters = () => {
    setQuery('')
    setMutedSources(new Set())
    setMutedNames(new Set())
    setProblemsOnly(false)
  }

  return (
    <div className="relative flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5">
        <FilterBox value={query} onChange={setQuery} />

        {SOURCES.map((source) => (
          <Chip
            key={source}
            active={!mutedSources.has(source)}
            tone={source === 'wire' ? 'wire' : 'plain'}
            count={census.sources[source]}
            title={source === 'wire' ? 'Events that arrived on the wire' : 'Decisions this app made'}
            onClick={() => setMutedSources(toggled(mutedSources, source))}
          >
            {source}
          </Chip>
        ))}

        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 transition hover:border-slate-300">
              {mutedNames.size > 0 ? `${mutedNames.size} type${mutedNames.size === 1 ? '' : 's'} hidden` : 'Types'}
              <ChevronDown className="size-3 text-slate-400" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <div className="flex items-center justify-between px-1.5 pb-1">
              <span className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">
                Event types
              </span>
              <button
                onClick={() => setMutedNames(new Set())}
                disabled={mutedNames.size === 0}
                className="text-[10px] text-slate-500 underline underline-offset-2 disabled:text-slate-300 disabled:no-underline"
              >
                Show all
              </button>
            </div>
            {census.names.size === 0 && (
              <p className="px-1.5 py-1 text-[11px] text-slate-400">Nothing has arrived yet.</p>
            )}
            {[...census.names].map(([name, count]) => (
              <PopoverCheck
                key={name}
                checked={!mutedNames.has(name)}
                count={count}
                onChange={() => setMutedNames(toggled(mutedNames, name))}
              >
                <span className="font-mono">{name}</span>
              </PopoverCheck>
            ))}
          </PopoverContent>
        </Popover>

        {census.problems > 0 && (
          <Chip
            active={problemsOnly}
            tone="problem"
            count={census.problems}
            title="Only the events that went wrong: rejected matches, invalid input, errors sent back to the model"
            onClick={() => setProblemsOnly((prior) => !prior)}
          >
            problems
          </Chip>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          {filtered && (
            <button
              onClick={clearFilters}
              className="text-[10px] text-slate-400 underline underline-offset-2 hover:text-slate-600"
            >
              {shown} of {timeline.length}
            </button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button
                title="Console settings"
                className="rounded border border-transparent p-0.5 text-slate-400 transition hover:border-slate-200 hover:bg-white hover:text-slate-600"
              >
                <Settings2 className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-60">
              <PopoverCheck checked={showGaps} onChange={setShowGaps}>
                Time column shows the gap
              </PopoverCheck>
              <PopoverCheck checked={foldRepeats} onChange={setFoldRepeats}>
                Fold repeated events
              </PopoverCheck>
              <p className="px-1.5 pt-1 text-[10px] leading-relaxed text-slate-400">
                Folding keeps events in arrival order. It only collapses neighbours that share a
                name.
              </p>
            </PopoverContent>
          </Popover>
        </span>
      </div>

      <ColumnHeader gaps={showGaps} />

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
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            No event matches.{' '}
            <button onClick={clearFilters} className="underline underline-offset-2">
              Clear the filters
            </button>
          </p>
        ) : (
          <ol>
            {rows.map((row) =>
              row.kind === 'group' && !expanded.has(row.id) ? (
                <GroupRow key={row.id} row={row} gaps={showGaps} query={query} onOpen={() => toggle(row.id)} />
              ) : row.kind === 'group' ? (
                <Fragment key={row.id}>
                  <GroupRow row={row} gaps={showGaps} query={query} open onOpen={() => toggle(row.id)} />
                  {row.entries.map((entry) => (
                    <EventRow
                      key={entry.id}
                      entry={entry}
                      stamp={row.stamps.get(entry.id)}
                      gaps={showGaps}
                      query={query}
                      nested
                      expanded={expanded.has(entry.id)}
                      onToggle={() => toggle(entry.id)}
                    />
                  ))}
                </Fragment>
              ) : (
                <EventRow
                  key={row.entry.id}
                  entry={row.entry}
                  stamp={row.stamp}
                  gaps={showGaps}
                  query={query}
                  expanded={expanded.has(row.entry.id)}
                  onToggle={() => toggle(row.entry.id)}
                />
              ),
            )}
          </ol>
        )}
      </div>

      {!following && rows.length > 0 && (
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

/** Shared by the header and every row, so nothing drifts. */
const COLUMNS = 'grid grid-cols-[3.75rem_2.25rem_10.5rem_minmax(0,1fr)] items-baseline gap-x-2'

const NEST = 'ml-[7.75rem]'

function ColumnHeader({ gaps }: { gaps: boolean }) {
  return (
    <div
      className={`${COLUMNS} shrink-0 border-y border-slate-200 px-3 py-1 text-[9px] font-medium tracking-wide text-slate-400 uppercase`}
    >
      <span className="text-right">{gaps ? 'Gap' : 'Time'}</span>
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

function EventRow({
  entry,
  stamp,
  gaps,
  query,
  expanded,
  onToggle,
  nested,
}: {
  entry: TimelineEntry
  stamp?: Stamp
  gaps: boolean
  query: string
  expanded: boolean
  onToggle: () => void
  nested?: boolean
}) {
  const { name, qualifier } = splitLabel(entry.label)
  const openable = entry.detail !== undefined || entry.raw !== undefined

  return (
    <li
      className={`border-b border-slate-100 text-[11px] leading-relaxed last:border-b-0 ${
        entry.tone === 'bad' ? 'bg-amber-50/60' : nested ? 'bg-slate-100/50' : ''
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
        <Clock at={stamp} gaps={gaps} />
        <span
          className={`font-medium ${entry.source === 'wire' ? 'text-blue-500' : 'text-slate-400'}`}
          title={SOURCE_TITLE[entry.source]}
        >
          {entry.source}
        </span>

        <span className="flex min-w-0 items-baseline gap-1">
          <Twisty open={expanded} shown={openable} nested={nested} />
          <span className={`truncate font-mono ${TONES[entry.tone ?? 'normal']}`} title={name}>
            <Highlight text={name} query={query} />
          </span>
        </span>

        <span className="flex min-w-0 items-baseline gap-2 truncate">
          {qualifier && (
            <span className="shrink-0 font-mono text-slate-500">
              <Highlight text={qualifier} query={query} />
            </span>
          )}
          {entry.raw !== undefined && (
            <span className="shrink-0 rounded bg-white px-1 font-mono text-slate-500">
              <Highlight text={JSON.stringify(entry.raw)} query={query} />
            </span>
          )}
          {entry.detail && (
            <span className="truncate text-slate-400">
              <Highlight text={entry.detail} query={query} />
            </span>
          )}
        </span>
      </div>

      {expanded && (
        <div className={`${NEST} mb-1 space-y-1.5 border-l-2 border-slate-200 pl-3`}>
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
          {entry.detail && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Highlight text={entry.detail} query={query} />
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function GroupRow({
  row,
  gaps,
  query,
  open,
  onOpen,
}: {
  row: Group
  gaps: boolean
  query: string
  open?: boolean
  onOpen: () => void
}) {
  const lead = row.entries[0]
  const spanMs = row.entries[row.entries.length - 1].atMs - lead.atMs
  const joined = row.entries.every((entry) => entry.raw !== undefined)
    ? row.entries.map((entry) => entry.raw).join('')
    : undefined

  return (
    <li className="border-b border-slate-100 text-[11px] leading-relaxed last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen()
          }
        }}
        className={`${COLUMNS} cursor-pointer py-0.5 hover:bg-slate-100/70`}
      >
        <Clock at={row.stamp} gaps={gaps} />
        <span
          className={`font-medium ${row.source === 'wire' ? 'text-blue-500' : 'text-slate-400'}`}
          title={SOURCE_TITLE[row.source]}
        >
          {row.source}
        </span>

        <span className="flex min-w-0 items-baseline gap-1">
          <Twisty open={open} shown />
          <span className="truncate font-mono text-slate-700">
            <Highlight text={row.name} query={query} />
          </span>
          <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600 tabular-nums">
            ×{row.entries.length}
          </span>
        </span>

        <span className="flex min-w-0 items-baseline gap-2 truncate text-slate-400">
          {joined !== undefined && (
            <span className="truncate rounded bg-white px-1 font-mono text-slate-500">
              {JSON.stringify(joined)}
            </span>
          )}
          <span className="shrink-0">over {(spanMs / 1000).toFixed(2)}s</span>
        </span>
      </div>
    </li>
  )
}

function Twisty({ open, shown, nested }: { open?: boolean; shown: boolean; nested?: boolean }) {
  return (
    <span className={`w-3 shrink-0 ${nested ? 'text-slate-200' : 'text-slate-300'}`}>
      {shown &&
        (open ? (
          <ChevronDown className="size-3 translate-y-0.5" />
        ) : (
          <ChevronRight className="size-3 translate-y-0.5" />
        ))}
    </span>
  )
}

/**
 * An app decision recorded outside the stream carries no elapsed time. Printing
 * the zero it was given would put it back at the start of a run it ended.
 */
function Clock({ at, gaps }: { at?: Stamp; gaps: boolean }) {
  if (!at?.stamped) {
    return (
      <span className="text-right text-slate-300" title="Recorded without an elapsed time">
        —
      </span>
    )
  }

  return (
    <span
      className="text-right tabular-nums text-slate-400"
      title={
        gaps ? `${(at.atMs / 1000).toFixed(2)}s into the run` : `${formatGap(at.gapMs)} after the previous event`
      }
    >
      {gaps ? formatGap(at.gapMs) : `${(at.atMs / 1000).toFixed(2)}s`}
    </span>
  )
}

function formatGap(ms: number): string {
  if (ms < 0) return '—'
  return ms < 1000 ? `+${Math.round(ms)}ms` : `+${(ms / 1000).toFixed(2)}s`
}

function FilterBox({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <label className="flex w-48 shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 focus-within:border-slate-400">
      <Search className="size-3 shrink-0 text-slate-300" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onChange('')}
        placeholder="Filter"
        aria-label="Filter events"
        className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-700 placeholder:text-slate-300 focus:outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} title="Clear the filter" className="shrink-0 text-slate-300 hover:text-slate-500">
          <X className="size-3" />
        </button>
      )}
    </label>
  )
}

const CHIP_TONES = {
  wire: 'border-blue-200 bg-blue-50 text-blue-600',
  plain: 'border-slate-300 bg-white text-slate-600',
  problem: 'border-amber-300 bg-amber-50 text-amber-700',
}

function Chip({
  active,
  tone,
  count,
  title,
  onClick,
  children,
}: {
  active: boolean
  tone: keyof typeof CHIP_TONES
  count: number
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition ${
        active ? CHIP_TONES[tone] : 'border-transparent bg-transparent text-slate-300 hover:text-slate-400'
      }`}
    >
      {children}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase()
  if (!needle) return <>{text}</>

  const hay = text.toLowerCase()
  const parts: ReactNode[] = []
  let at = 0
  for (let found = hay.indexOf(needle); found !== -1; found = hay.indexOf(needle, at)) {
    parts.push(text.slice(at, found))
    parts.push(
      <mark key={found} className="rounded-xs bg-amber-200 text-slate-800">
        {text.slice(found, found + needle.length)}
      </mark>,
    )
    at = found + needle.length
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

/**
 * Labels read `content_block_start · tool_use` or `request sent (turn 2)`: the
 * event name, then what that instance of it carried. Splitting them is what
 * lets the name column line up, and it is what the type filter counts. Without
 * the parenthetical split, every turn of a run would be its own type.
 */
function splitLabel(label: string): { name: string; qualifier?: string } {
  const at = label.indexOf(' · ')
  const head = at === -1 ? label : label.slice(0, at)
  const tail = at === -1 ? undefined : label.slice(at + 3)

  const parenthetical = /^(.*?) \(([^()]*)\)$/.exec(head)
  if (!parenthetical) return { name: head, qualifier: tail }

  const [, name, inside] = parenthetical
  return { name, qualifier: [inside, tail].filter(Boolean).join(' · ') }
}

function haystack(entry: TimelineEntry): string {
  return `${entry.label} ${entry.detail ?? ''} ${entry.raw ?? ''}`.toLowerCase()
}

function toggled<T>(muted: ReadonlySet<T>, key: T): ReadonlySet<T> {
  const next = new Set(muted)
  if (!next.delete(key)) next.add(key)
  return next
}

interface Census {
  names: Map<string, number>
  sources: Record<TimelineSource, number>
  problems: number
}

function tally(timeline: TimelineEntry[]): Census {
  const census: Census = { names: new Map(), sources: { wire: 0, app: 0 }, problems: 0 }
  for (const entry of timeline) {
    const { name } = splitLabel(entry.label)
    census.names.set(name, (census.names.get(name) ?? 0) + 1)
    census.sources[entry.source] += 1
    if (entry.tone === 'bad') census.problems += 1
  }
  return census
}

interface Stamp {
  index: number
  atMs: number
  gapMs: number
  stamped: boolean
}

interface EntryRow {
  kind: 'entry'
  entry: TimelineEntry
  stamp?: Stamp
}

interface Group {
  kind: 'group'
  id: string
  name: string
  source: TimelineSource
  entries: TimelineEntry[]
  stamp?: Stamp
  stamps: Map<string, Stamp>
}

type ConsoleRow = EntryRow | Group

function single(entry: TimelineEntry, stamps: Map<string, Stamp>): EntryRow {
  return { kind: 'entry', entry, stamp: stamps.get(entry.id) }
}

/**
 * Collapses neighbouring events that share a name and a source, which is what a
 * run of `input_json_delta` is. A run of one stays a plain row, and anything
 * that went wrong stays a row of its own so folding can never bury it.
 *
 * Neighbouring means neighbouring in the run, not in the filtered list. Two
 * fragment runs with a hidden `message_delta` between them are two segments of
 * the stream, and a group that spliced their fragments together would read as
 * one thing the model never sent.
 */
function adjacent(prior: TimelineEntry, entry: TimelineEntry, stamps: Map<string, Stamp>): boolean {
  const before = stamps.get(prior.id)
  const after = stamps.get(entry.id)
  return before !== undefined && after !== undefined && after.index === before.index + 1
}

function fold(entries: TimelineEntry[], stamps: Map<string, Stamp>): ConsoleRow[] {
  const rows: ConsoleRow[] = []
  let run: TimelineEntry[] = []

  const flush = () => {
    if (run.length === 0) return
    const lead = run[0]
    if (run.length === 1) rows.push(single(lead, stamps))
    else
      rows.push({
        kind: 'group',
        id: `group-${lead.id}`,
        name: splitLabel(lead.label).name,
        source: lead.source,
        entries: run,
        stamp: stamps.get(lead.id),
        stamps,
      })
    run = []
  }

  for (const entry of entries) {
    const prior = run[run.length - 1]
    const same =
      prior !== undefined &&
      prior.source === entry.source &&
      splitLabel(prior.label).name === splitLabel(entry.label).name &&
      entry.tone !== 'bad' &&
      prior.tone !== 'bad' &&
      adjacent(prior, entry, stamps)
    if (!same) flush()
    run.push(entry)
  }
  flush()

  return rows
}
