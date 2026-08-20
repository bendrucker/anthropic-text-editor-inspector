import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ChevronDown, ChevronRight, Search, Settings2, X } from 'lucide-react'
import { Popover, PopoverCheck, PopoverContent, PopoverTrigger } from './ui/popover'
import { Tooltip } from './ui/tooltip'
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

  // Timings come off the full timeline, so a filtered row still reports the
  // wait that actually preceded it. A gap is measured from the last event that
  // carried a real time, because an entry recorded without one would otherwise
  // charge the whole run so far to whatever followed it.
  const stamps = useMemo(() => {
    const map = new Map<string, Stamp>()
    let previous = 0
    for (const [index, entry] of timeline.entries()) {
      const stamped = index === 0 || entry.atMs > 0
      map.set(entry.id, { index, atMs: entry.atMs, gapMs: entry.atMs - previous, stamped })
      if (stamped) previous = entry.atMs
    }
    return map
  }, [timeline])

  const { rows, shown } = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const kept = timeline.filter((entry) => {
      if (mutedSources.has(entry.source)) return false
      if (mutedNames.has(splitLabel(entry.label).name)) return false
      if (problemsOnly && entry.tone !== 'bad') return false
      return needle === '' || haystack(entry).includes(needle)
    })

    return {
      rows: foldRepeats ? fold(kept, stamps) : kept.map((entry) => single(entry, stamps)),
      shown: kept.length,
    }
  }, [timeline, stamps, query, mutedSources, mutedNames, problemsOnly, foldRepeats])

  const filtered = shown !== timeline.length

  // A console follows the tail until you scroll away from it, and picks the
  // tail up again when you come back. Yanking a list someone is reading is
  // worse than losing sight of the newest row.
  useEffect(() => {
    const view = scrollRef.current
    if (following && view) view.scrollTo({ top: view.scrollHeight })
  }, [rows, following])

  const toggle = (id: string) => setExpanded((prior) => toggled(prior, id))

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
            explanation={
              source === 'wire' ? (
                <>
                  Events the API sent: block boundaries, tool input fragments, message deltas.
                  Hiding them leaves only what this app decided in response.
                </>
              ) : (
                <>
                  Decisions this app made while reading the stream: a match located or refused, a
                  highlight moved, a tool result sent back. Hiding them leaves the raw wire.
                </>
              )
            }
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

        {/* Kept while the filter is on even at a count of zero, so a clean run
            cannot hide the control that is emptying the console. */}
        {(census.problems > 0 || problemsOnly) && (
          <Chip
            active={problemsOnly}
            tone="problem"
            count={census.problems}
            explanation={
              <>
                Keeps only the events that went wrong: an <code>old_str</code> that matched nowhere
                or matched more than once, tool input the schema refused, and the errors handed back
                to the model. With prompt rules off this is where the retry loop shows up.
              </>
            }
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
            <Tooltip content="Console settings: what the time column measures, and whether repeated events fold together.">
              <PopoverTrigger asChild>
                <button
                  aria-label="Console settings"
                  className="rounded border border-transparent p-0.5 text-slate-400 transition hover:border-slate-200 hover:bg-white hover:text-slate-600"
                >
                  <Settings2 className="size-3.5" />
                </button>
              </PopoverTrigger>
            </Tooltip>
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

      {/* The header stays put by living outside the scroller, which leaves the
          columns and the rows in separate elements. The table role has to wrap
          both for a cell to find its header. */}
      <div role="table" aria-label="Run events" className="flex min-h-0 flex-1 flex-col">
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
            <div role="rowgroup">
              {rows.map((row) =>
                row.kind === 'group' ? (
                  <Fragment key={row.id}>
                    <GroupRow
                      row={row}
                      gaps={showGaps}
                      query={query}
                      open={expanded.has(row.id)}
                      onOpen={() => toggle(row.id)}
                    />
                    {expanded.has(row.id) &&
                      row.entries.map((entry) => (
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
            </div>
          )}
        </div>
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
      role="row"
      className={`${COLUMNS} shrink-0 border-y border-slate-200 px-3 py-1 text-[9px] font-medium tracking-wide text-slate-400 uppercase`}
    >
      <span role="columnheader" className="text-right">
        {gaps ? 'Gap' : 'Time'}
      </span>
      <span role="columnheader">Src</span>
      <span role="columnheader" className="pl-4">
        Event
      </span>
      <span role="columnheader">Detail</span>
    </div>
  )
}

const TONES: Record<string, string> = {
  good: 'text-emerald-700',
  bad: 'text-amber-700',
  normal: 'text-slate-700',
}

const SOURCE_EXPLANATION: Record<TimelineSource, ReactNode> = {
  wire: 'Arrived on the wire exactly as the API sent it.',
  app: 'A decision this app made while reading the stream, not something the API sent.',
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
  const label = (
    <Tooltip content={<span className="font-mono">{name}</span>}>
      <span className={`truncate font-mono ${TONES[entry.tone ?? 'normal']}`}>
        <Highlight text={name} query={query} />
      </span>
    </Tooltip>
  )

  return (
    <div
      className={`border-b border-slate-100 text-[11px] leading-relaxed last:border-b-0 ${
        entry.tone === 'bad' ? 'bg-amber-50/60' : nested ? 'bg-slate-100/50' : ''
      }`}
    >
      <div
        role="row"
        id={rowId(entry.id)}
        onClick={openable ? onToggle : undefined}
        className={`${COLUMNS} py-0.5 ${openable ? 'cursor-pointer hover:bg-slate-100/70' : ''}`}
      >
        <Clock at={stamp} gaps={gaps} />
        <Tooltip content={SOURCE_EXPLANATION[entry.source]}>
          <span
            role="cell"
            className={`font-medium ${entry.source === 'wire' ? 'text-blue-500' : 'text-slate-400'}`}
          >
            {entry.source}
          </span>
        </Tooltip>

        <span role="cell" className="flex min-w-0 items-baseline gap-1">
          {openable ? (
            <Disclosure open={expanded} controls={detailId(entry.id)} onToggle={onToggle}>
              <Twisty open={expanded} shown nested={nested} />
              {label}
            </Disclosure>
          ) : (
            <>
              <Twisty shown={false} nested={nested} />
              {label}
            </>
          )}
        </span>

        <span role="cell" className="flex min-w-0 items-baseline gap-2 truncate">
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
        <div role="row">
          <div
            role="cell"
            aria-colspan={4}
            id={detailId(entry.id)}
            className={`${NEST} mb-1 space-y-1.5 border-l-2 border-slate-200 pl-3`}
          >
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
        </div>
      )}
    </div>
  )
}

const rowId = (id: string) => `event-${id}`
const detailId = (id: string) => `event-${id}-detail`

/**
 * A row is not a control, so the event name carries the disclosure instead. The
 * whole row stays clickable for a pointer, which is why the button has to stop
 * the click it already handled from reaching the row underneath.
 */
function Disclosure({
  open,
  controls,
  onToggle,
  children,
}: {
  open: boolean
  controls: string
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className="flex min-w-0 cursor-pointer items-baseline gap-1 text-left"
    >
      {children}
    </button>
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
    <div className="border-b border-slate-100 text-[11px] leading-relaxed last:border-b-0">
      <div
        role="row"
        onClick={onOpen}
        className={`${COLUMNS} cursor-pointer py-0.5 hover:bg-slate-100/70`}
      >
        <Clock at={row.stamp} gaps={gaps} />
        <Tooltip content={SOURCE_EXPLANATION[row.source]}>
          <span
            role="cell"
            className={`font-medium ${row.source === 'wire' ? 'text-blue-500' : 'text-slate-400'}`}
          >
            {row.source}
          </span>
        </Tooltip>

        <span role="cell" className="flex min-w-0 items-baseline gap-1">
          {/* Folding hides rows rather than a panel, so the disclosure points at
              the rows it reveals instead of at one detail cell. */}
          <Disclosure
            open={Boolean(open)}
            controls={row.entries.map((entry) => rowId(entry.id)).join(' ')}
            onToggle={onOpen}
          >
            <Twisty open={open} shown />
            <span className="truncate font-mono text-slate-700">
              <Highlight text={row.name} query={query} />
            </span>
            <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600 tabular-nums">
              ×{row.entries.length}
            </span>
          </Disclosure>
        </span>

        <span role="cell" className="flex min-w-0 items-baseline gap-2 truncate text-slate-400">
          {joined !== undefined && (
            <span className="truncate rounded bg-white px-1 font-mono text-slate-500">
              {JSON.stringify(joined)}
            </span>
          )}
          <span className="shrink-0">over {formatElapsed(spanMs)}</span>
        </span>
      </div>
    </div>
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
      <Tooltip
        content={
          <>
            Recorded without an elapsed time. This decision was made outside the stream, so printing
            the zero it was given would put it back at the start of a run it ended.
          </>
        }
      >
        <span role="cell" className="text-right text-slate-300">
          —
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip
      content={
        gaps
          ? `${formatElapsed(at.atMs)} into the run`
          : `${formatGap(at.gapMs)} after the previous event`
      }
    >
      <span role="cell" className="text-right tabular-nums text-slate-400">
        {gaps ? formatGap(at.gapMs) : formatElapsed(at.atMs)}
      </span>
    </Tooltip>
  )
}

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}

function formatGap(ms: number): string {
  if (ms < 0) return '—'
  return ms < 1000 ? `+${Math.round(ms)}ms` : `+${formatElapsed(ms)}`
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
        <Tooltip content="Clear the filter. Escape does the same from inside the box.">
          <button
            onClick={() => onChange('')}
            aria-label="Clear the filter"
            className="shrink-0 text-slate-300 hover:text-slate-500"
          >
            <X className="size-3" />
          </button>
        </Tooltip>
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
  explanation,
  onClick,
  children,
}: {
  active: boolean
  tone: keyof typeof CHIP_TONES
  count: number
  explanation: ReactNode
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip content={explanation}>
      <button
        onClick={onClick}
        aria-pressed={active}
        className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition ${
          active ? CHIP_TONES[tone] : 'border-transparent bg-transparent text-slate-300 hover:text-slate-400'
        }`}
      >
        {children}
        <span className="tabular-nums opacity-70">{count}</span>
      </button>
    </Tooltip>
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
  let runName = ''

  const flush = () => {
    if (run.length === 0) return
    const lead = run[0]
    if (run.length === 1) rows.push(single(lead, stamps))
    else
      rows.push({
        kind: 'group',
        id: `group-${lead.id}`,
        name: runName,
        source: lead.source,
        entries: run,
        stamp: stamps.get(lead.id),
        stamps,
      })
    run = []
  }

  for (const entry of entries) {
    const name = splitLabel(entry.label).name
    const prior = run[run.length - 1]
    const same =
      prior !== undefined &&
      prior.source === entry.source &&
      runName === name &&
      entry.tone !== 'bad' &&
      prior.tone !== 'bad' &&
      adjacent(prior, entry, stamps)
    if (!same) flush()
    run.push(entry)
    runName = name
  }
  flush()

  return rows
}
