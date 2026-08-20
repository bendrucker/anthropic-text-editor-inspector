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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
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

  // A turn head is not a row, so nothing that counts, filters, or folds rows may
  // count it either. Every census below is taken over the same set the list draws.
  const turns = useMemo(() => planTurns(timeline), [timeline])
  const heads = useMemo(() => new Set(turns.map((turn) => turn.id)), [turns])
  const census = useMemo(() => tally(timeline, heads), [timeline, heads])

  // Timings come off the full timeline, so a filtered row still reports the
  // wait that actually preceded it. A gap is measured from the last event that
  // carried a real time, because an entry recorded without one would otherwise
  // charge the whole run so far to whatever followed it.
  const stamps = useMemo(() => {
    const map = new Map<string, Stamp>()
    let previous = 0
    let afterHead = false
    for (const [index, entry] of timeline.entries()) {
      const stamped = index === 0 || entry.atMs > 0
      const gapMs = entry.atMs - previous
      map.set(entry.id, {
        index,
        atMs: entry.atMs,
        gapMs,
        stamped,
        afterHead,
        backwards: stamped && gapMs < 0,
      })
      if (stamped) {
        previous = entry.atMs
        afterHead = heads.has(entry.id)
      }
    }
    return map
  }, [timeline, heads])

  const { sections, shown, listed } = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const kept = timeline.filter((entry) => {
      if (heads.has(entry.id)) return false
      if (mutedSources.has(entry.source)) return false
      if (mutedNames.has(splitLabel(entry.label).name)) return false
      if (problemsOnly && entry.tone !== 'bad') return false
      return needle === '' || haystack(entry).includes(needle)
    })

    const events = foldRepeats ? fold(kept, stamps) : kept.map((entry) => single(entry, stamps))
    return {
      sections: sectioned(events, turns, stamps),
      shown: kept.length,
      listed: timeline.length - heads.size,
    }
  }, [timeline, turns, heads, stamps, query, mutedSources, mutedNames, problemsOnly, foldRepeats])

  const filtered = shown !== listed

  // A console follows the tail until you scroll away from it, and picks the
  // tail up again when you come back. Yanking a list someone is reading is
  // worse than losing sight of the newest row.
  useEffect(() => {
    const view = scrollRef.current
    if (following && view) view.scrollTo({ top: view.scrollHeight })
  }, [sections, following])

  // Scrolling is not the only way the tail leaves the viewport. An opened panel
  // grows the list under the reader and a resized drawer shrinks it, and neither
  // fires a scroll event, so the console would keep claiming to follow a tail it
  // had already lost.
  //
  // A resize can only take the tail away, never hand it back. Scrolling to the
  // bottom is what returns, and the button says so. Read both ways, the bottom
  // test would undo the rule below that opening a row leaves the tail, because
  // the slack it allows is a row tall and so is the panel most rows open.
  useEffect(() => {
    const view = scrollRef.current
    if (!view) return

    const observer = new ResizeObserver(() => {
      // A list that fits has no tail to lose, and leaving it unfollowed would
      // strand the button over a console with nothing to scroll.
      if (overflow(view) < BOTTOM_SLACK_PX) setFollowing(true)
      else if (!atBottom(view)) setFollowing(false)
    })
    observer.observe(view)
    if (rowsRef.current) observer.observe(rowsRef.current)
    return () => observer.disconnect()
  }, [sections])

  // Opening a row is a reader settling on it, and the panel it opens pushes the
  // rows below out of view. Closing one says nothing either way, so it leaves
  // the decision where the reader last put it.
  const toggle = (id: string) => {
    if (!expanded.has(id)) setFollowing(false)
    setExpanded((prior) => toggled(prior, id))
  }

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
              <ChevronDown className="size-3 text-slate-500" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <div className="flex items-center justify-between px-1.5 pb-1">
              <span className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
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
              <p className="px-1.5 py-1 text-[11px] text-slate-500">Nothing has arrived yet.</p>
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
              className="text-[10px] text-slate-500 underline underline-offset-2 hover:text-slate-700"
            >
              {shown} of {listed}
            </button>
          )}
          <Popover>
            <Tooltip content="Console settings: whether repeated events fold together.">
              <PopoverTrigger asChild>
                <button
                  aria-label="Console settings"
                  className="rounded border border-transparent p-0.5 text-slate-500 transition hover:border-slate-200 hover:bg-white hover:text-slate-700"
                >
                  <Settings2 className="size-3.5" />
                </button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent className="w-60">
              <PopoverCheck checked={foldRepeats} onChange={setFoldRepeats}>
                Fold repeated events
              </PopoverCheck>
              <p className="px-1.5 pt-1 text-[10px] leading-relaxed text-slate-500">
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
        <ColumnHeader />

        <div
          ref={scrollRef}
          onScroll={(event) => setFollowing(atBottom(event.currentTarget))}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-1"
        >
          {timeline.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              Ask for an edit. Every event that crosses the wire lands here.
            </p>
          ) : sections.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              No event matches.{' '}
              <button onClick={clearFilters} className="underline underline-offset-2">
                Clear the filters
              </button>
            </p>
          ) : (
            <div ref={rowsRef}>
              {sections.map((section) => (
                // A turn is a group of rows, which is what a row group is for.
                // It also bounds its own separator, so the heading leaves with
                // the rows it names instead of collecting at the top.
                <div role="rowgroup" key={section.id} className="relative">
                  {section.turn && <TurnSeparator turn={section.turn} />}
                  {section.rows.map((row) =>
                    row.kind === 'group' ? (
                      <Fragment key={row.id}>
                        <GroupRow
                          row={row}
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
                        query={query}
                        expanded={expanded.has(row.entry.id)}
                        onToggle={() => toggle(row.entry.id)}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!following && sections.length > 0 && (
        <button
          onClick={() => setFollowing(true)}
          className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-300 bg-white/95 px-2.5 py-1 text-[10px] font-medium text-slate-600 shadow-sm transition hover:border-slate-400"
        >
          <ArrowDown className="size-3" />
          Follow the tail
        </button>
      )}
    </div>
  )
}

/** Shared by the header and every row, so nothing drifts. */
const COLUMNS =
  'grid grid-cols-[3.75rem_3.75rem_2.25rem_10.5rem_minmax(0,1fr)] items-baseline gap-x-2'

const NEST = 'ml-[12rem]'

/**
 * Elapsed and gap answer different questions, and a run being read for where its
 * time went needs both at once: when this event landed, and what the wait before
 * it cost. Either one alone leaves the other to be worked out by subtracting
 * across rows that are rarely adjacent.
 */
function ColumnHeader() {
  return (
    <div
      role="row"
      className={`${COLUMNS} shrink-0 border-y border-slate-200 px-3 py-1 text-[9px] font-medium tracking-wide text-slate-600 uppercase`}
    >
      <Tooltip
        content={
          <>
            How far into the run this event landed. Rows are in arrival order, and a frame can paint
            after the stream that caused it has closed, so the last rows of a run can carry a
            smaller number than the one above them.
          </>
        }
      >
        <span role="columnheader" className="text-right">
          Time
        </span>
      </Tooltip>
      <Tooltip content="The wait this event ended. The rows carrying the largest numbers here are the ones spending the run.">
        <span role="columnheader" className="text-right">
          Gap
        </span>
      </Tooltip>
      <span role="columnheader">Src</span>
      <span role="columnheader" className="pl-4">
        Event
      </span>
      <span role="columnheader">Detail</span>
    </div>
  )
}

/**
 * The unit a run is actually organised into, and the one thing the console could
 * not say. A turn is what costs time: ten seconds spent without the document
 * changing is the answer to where a run went, and no single row states it.
 *
 * The `request sent (turn N)` entry is promoted into this rather than drawn
 * beside it. That entry is the turn's announcement, so leaving it in the list as
 * one more monospace row alongside `content_block_stop` was the defect. Its
 * settings ride along in the tooltip, which is the only thing lost by promoting
 * it. Printed on the band they set the console's minimum width: this row is the
 * one thing here wider than a truncating column, and the drawer gives 340px of
 * its width to the panel beside it.
 *
 * It sticks to the top of its own section, so the turn stays named while its own
 * rows scroll past and leaves once they have. That matters most in the short
 * drawer this console usually lives in.
 */
function TurnSeparator({ turn }: { turn: Turn }) {
  return (
    <div
      role="row"
      className="sticky top-0 z-10 -mx-3 border-y border-slate-400 bg-slate-200 px-3 py-0.5 text-[11px] leading-relaxed"
    >
      <Tooltip content={turnBand(turn)} side="top" align="start">
        <span role="cell" aria-colspan={5} className="flex w-fit items-baseline gap-1.5">
          <span className="shrink-0 font-medium text-slate-700">turn {turn.number}</span>
          <span className="shrink-0 font-medium text-slate-700 tabular-nums">
            · {formatElapsed(turn.spanMs)}
            {turn.closed ? '' : ' so far'}
          </span>
          {(turn.changed || turn.closed) && (
            <span className="shrink-0 text-slate-700">
              · {turn.changed ? 'edit applied' : 'no edit applied'}
            </span>
          )}
          {showsPaints(turn) && (
            <span className="shrink-0 text-slate-700 tabular-nums">
              · {turn.paints} paint{turn.paints === 1 ? '' : 's'}
            </span>
          )}
        </span>
      </Tooltip>
    </div>
  )
}

/**
 * A turn that applied nothing and painted anyway says so, because that is the
 * pairing that read as a bug.
 *
 * A turn that applied an edit is not counted here. Its paint rows are the edit
 * the band already named, so a number beside them would be noise on the common
 * case to explain the rare one. The withholding matches the verdict's: an open
 * turn has no settled account of either.
 */
function showsPaints(turn: Turn): boolean {
  return turn.closed && !turn.changed && turn.paints > 0
}

/**
 * What the band counted, which is the one thing its own words could not carry.
 *
 * The verdict used to read `no document change`. That names the document, so it
 * was heard as a claim about what was on screen, and the rows underneath are
 * frames. A frame carrying an earlier turn's edit lands whenever it lands, and
 * nothing re-sorts the list, so the band and the paint rows inside it stated
 * opposite things about the same document. Both were true. Neither said which
 * question it was answering.
 *
 * So the verdict names what it actually counts, which is this turn's tool calls.
 * The paint count beside it answers the other question outright, rather than
 * leaving a reader to find the rows and doubt the band.
 */
function turnBand(turn: Turn): ReactNode {
  const verdict = turn.changed ? (
    <>
      A <code>str_replace</code> call in this turn was applied to the document.
    </>
  ) : turn.closed ? (
    <>
      No <code>str_replace</code> call in this turn was applied to the document. This counts the
      turn's tool calls, not what was on screen while it ran.
      {showsPaints(turn) && (
        <>
          {' '}
          The document still moved: a paint reports a frame, and an earlier turn's edit finishing its
          commit or a rejected edit closing its hole both paint without anything being applied here.
        </>
      )}
    </>
  ) : undefined

  // Undefined rather than an empty element, because `Tooltip` reads that as
  // having nothing to say and leaves the band without a trigger at all.
  if (turn.detail === undefined && verdict === undefined) return undefined

  return (
    <div className="space-y-2">
      {turn.detail !== undefined && <p>{turn.detail}</p>}
      {verdict !== undefined && <p>{verdict}</p>}
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
  query,
  expanded,
  onToggle,
  nested,
}: {
  entry: TimelineEntry
  stamp?: Stamp
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
        <Clock at={stamp} />
        <Gap at={stamp} />
        <Tooltip content={SOURCE_EXPLANATION[entry.source]}>
          <span
            role="cell"
            className={`font-medium ${entry.source === 'wire' ? 'text-blue-600' : 'text-slate-600'}`}
          >
            {entry.source}
          </span>
        </Tooltip>

        <span role="cell" className="flex min-w-0 items-baseline gap-1">
          {openable ? (
            <Disclosure open={expanded} controls={detailId(entry.id)} onToggle={onToggle}>
              <Twisty open={expanded} shown />
              {label}
            </Disclosure>
          ) : (
            <>
              <Twisty shown={false} />
              {label}
            </>
          )}
        </span>

        <span role="cell" className="flex min-w-0 items-baseline gap-2 truncate">
          {qualifier && (
            <span className="shrink-0 font-mono text-slate-600">
              <Highlight text={qualifier} query={query} />
            </span>
          )}
          {entry.raw !== undefined && (
            <span className="shrink-0 rounded bg-white px-1 font-mono text-slate-500">
              <Highlight text={JSON.stringify(entry.raw)} query={query} />
            </span>
          )}
          {entry.detail && (
            <span className="truncate text-slate-600">
              <Highlight text={entry.detail} query={query} />
            </span>
          )}
        </span>
      </div>

      {expanded && (
        <div role="row">
          <div
            role="cell"
            aria-colspan={5}
            id={detailId(entry.id)}
            className={`${NEST} mb-1 space-y-1.5 border-l-2 border-slate-200 pl-3`}
          >
            {entry.raw !== undefined && (
              <div>
                <p className="text-[10px] font-medium text-slate-600">
                  Raw fragment · {entry.raw.length} chars
                </p>
                {/* The fragment is printed as the bytes that arrived. It is not
                    valid JSON yet, and the scanner reads fields out of it
                    anyway. That is what this panel exists to show, so quoting it
                    a second time would hide the only thing it has to say. */}
                <pre className="mt-0.5 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-slate-600">
                  {entry.raw}
                </pre>
              </div>
            )}
            {entry.detail && (
              <p className="text-[10px] leading-relaxed text-slate-600">
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
  query,
  open,
  onOpen,
}: {
  row: Group
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
        <Clock at={row.stamp} />
        <Gap at={row.stamp} />
        <Tooltip content={SOURCE_EXPLANATION[row.source]}>
          <span
            role="cell"
            className={`font-medium ${row.source === 'wire' ? 'text-blue-600' : 'text-slate-600'}`}
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

        <span role="cell" className="flex min-w-0 items-baseline gap-2 truncate text-slate-600">
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

function Twisty({ open, shown }: { open?: boolean; shown: boolean }) {
  return (
    <span className="w-3 shrink-0 text-slate-500">
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
function Unstamped() {
  return (
    <Tooltip
      content={
        <>
          Recorded without an elapsed time. This decision was made outside the stream, so printing
          the zero it was given would put it back at the start of a run it ended.
        </>
      }
    >
      <span role="cell" className="text-right text-slate-600">
        —
      </span>
    </Tooltip>
  )
}

/**
 * A row stamped earlier than the event before it ended no wait, so there is no
 * duration to print.
 *
 * It prints a word where an unstamped row prints a dash. Sharing the dash made
 * two different facts look like one missing value, and a missing value is what
 * a reader already suspects when Time descends: the number above looks wrong
 * and nothing beside it disagrees. A word is visibly deliberate, which is the
 * whole difference between a console that knows and one that has a sort bug.
 * The tooltip carries the reason, as it does everywhere else here.
 *
 * Measured against the preceding timeline event rather than the row drawn
 * above, which under a filter can be another event entirely or none at all.
 */
function NoGap() {
  return (
    <Tooltip
      content={
        <>
          No wait to measure. This event is stamped earlier than the one before it, so the interval
          between them runs backwards.
        </>
      }
    >
      <span role="cell" className="text-right text-slate-600">
        back
      </span>
    </Tooltip>
  )
}

function Clock({ at }: { at?: Stamp }) {
  if (!at?.stamped) return <Unstamped />

  return (
    <Tooltip
      content={
        at.backwards ? (
          <>
            {formatElapsed(at.atMs)} into the run, which is earlier than the event before it. Both
            are measured from the same start, but one is a wire event and the other is a frame, and
            a frame can land after the stream that caused it has closed. The list is in arrival
            order and nothing re-sorts it, so the two are printed where they arrived.
          </>
        ) : (
          `${formatElapsed(at.atMs)} into the run`
        )
      }
    >
      <span role="cell" className="text-right tabular-nums text-slate-600">
        {formatElapsed(at.atMs)}
      </span>
    </Tooltip>
  )
}

/**
 * A turn's first row has no visible row before it, since the request that opened
 * the turn is drawn as the separator above. Its gap is still measured from that
 * request, and that wait is the connection and the model's start-up. Dashing it
 * out would hide the largest number in a typical run, so it is printed and the
 * tooltip names what it was measured from.
 */
function Gap({ at }: { at?: Stamp }) {
  if (!at?.stamped) return <Unstamped />
  if (at.backwards) return <NoGap />

  return (
    <Tooltip
      content={
        at.index === 0
          ? `${formatGap(at.gapMs)} after the run started`
          : at.afterHead
            ? `${formatGap(at.gapMs)} after the request that opened this turn`
            : `${formatGap(at.gapMs)} after the previous event`
      }
    >
      <span role="cell" className="text-right tabular-nums text-slate-600">
        {formatGap(at.gapMs)}
      </span>
    </Tooltip>
  )
}

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}

/** Only ever called for a row that ended a wait, since `Gap` handles the rest. */
function formatGap(ms: number): string {
  return ms < 1000 ? `+${Math.round(ms)}ms` : `+${formatElapsed(ms)}`
}

function FilterBox({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <label className="flex w-48 shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 focus-within:border-slate-400">
      <Search className="size-3 shrink-0 text-slate-500" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onChange('')}
        placeholder="Filter"
        aria-label="Filter events"
        className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-700 placeholder:text-slate-500 focus-ring"
      />
      {value && (
        <Tooltip content="Clear the filter. Escape does the same from inside the box.">
          <button
            onClick={() => onChange('')}
            aria-label="Clear the filter"
            className="shrink-0 text-slate-500 hover:text-slate-700"
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
          active ? CHIP_TONES[tone] : 'border-transparent bg-transparent text-slate-500 hover:text-slate-700'
        }`}
      >
        {children}
        <span className="tabular-nums">{count}</span>
      </button>
    </Tooltip>
  )
}

/**
 * The mark is violet. Amber is this console's failure colour, on the problems
 * chip, on a bad row's tint and on its event name, so highlighting matches in
 * amber painted a search across healthy rows as a run full of problems.
 */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase()
  if (!needle) return <>{text}</>

  const hay = text.toLowerCase()
  const parts: ReactNode[] = []
  let at = 0
  for (let found = hay.indexOf(needle); found !== -1; found = hay.indexOf(needle, at)) {
    parts.push(text.slice(at, found))
    parts.push(
      <mark key={found} className="rounded-xs bg-violet-200 text-violet-950">
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

function tally(timeline: TimelineEntry[], heads: ReadonlySet<string>): Census {
  const census: Census = { names: new Map(), sources: { wire: 0, app: 0 }, problems: 0 }
  for (const entry of timeline) {
    if (heads.has(entry.id)) continue
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
  /** Whether the wait this row ended began at the request that opened its turn. */
  afterHead: boolean
  /**
   * Whether this row's clock reads earlier than the timeline event before it.
   *
   * Paints and wire events are stamped on the same axis but by different
   * things, so a frame can land after the stream that caused it has closed.
   * Arrival order then puts a larger number above a smaller one, and Time stops
   * being a column a reader can follow downwards.
   *
   * Taken over the whole timeline, like the gap beside it, so a filtered row
   * still reports what actually preceded it. The row drawn above is therefore
   * not what this compares against, and nothing that reads it may say so.
   */
  backwards: boolean
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

/**
 * One turn's rows, under the separator that names it.
 *
 * The rows are grouped rather than flattened with a marker between them so that
 * each separator sticks inside its own turn. Siblings all pinned to the top of
 * one list would pile up there, and a run of five turns would spend its whole
 * drawer on five headings, four of them naming turns that had scrolled away.
 */
interface Section {
  id: string
  turn?: Turn
  rows: (EntryRow | Group)[]
}

type ConsoleRow = EntryRow | Group

function single(entry: TimelineEntry, stamps: Map<string, Stamp>): EntryRow {
  return { kind: 'entry', entry, stamp: stamps.get(entry.id) }
}

/** One row's worth of slack, so resting a row short of the end still counts as the end. */
const BOTTOM_SLACK_PX = 24

const overflow = (view: HTMLElement) => view.scrollHeight - view.clientHeight

/** The scroller is following the tail when the last row is within a row of it. */
function atBottom(view: HTMLElement): boolean {
  return overflow(view) - view.scrollTop < BOTTOM_SLACK_PX
}

/**
 * Four labels the console reads as structure rather than as text. The run
 * writes them in `lib/agent.ts` and `hooks/use-live-document.ts`, and nothing
 * else in the timeline says where a turn begins, whether an edit was applied,
 * whether a frame carried it to the screen, or whether the run is over.
 *
 * `EDIT_APPLIED` and `PAINT` are two different questions and neither answers
 * the other. One is a tool result and the other is a frame, so a turn can carry
 * either without the other.
 */
const TURN_HEAD = 'request sent'
const EDIT_APPLIED = 'tool_result · ok'
const PAINT = 'paint'
const RUN_END = 'run complete'

interface Turn {
  /** The id of the `request sent` entry this turn was promoted from. */
  id: string
  number: number
  /** Position of that entry in the full timeline, so rows can be placed against it. */
  headIndex: number
  spanMs: number
  /**
   * Whether a tool call in this turn applied an edit. A turn that applied
   * nothing is the run's real cost.
   *
   * This is a fact about the turn's tool calls and about nothing else. It is
   * not whether the document looked different during the turn, which is what
   * `paints` counts, and the band may not word it as though it were.
   */
  changed: boolean
  /**
   * Frames that painted between this turn's head and the next.
   *
   * Paints and tool calls are stamped on one axis by different things, so they
   * do not have to line up. A block-replaced edit commits after its own turn
   * has closed, which drops its paint inside a later turn that applied nothing.
   */
  paints: number
  /**
   * Whether the turn ended. An open turn reports its span so far and withholds
   * the negative verdict, because the tool result that would settle it arrives
   * last. A run that was stopped or that failed writes no ending, so its final
   * turn stays open rather than claiming a close nothing reported.
   */
  closed: boolean
  detail?: string
}

/**
 * How the console will divide a timeline: rows it lists, and bands it draws
 * between them.
 *
 * A `request sent` entry opens a turn, and the console draws it as the
 * separator above that turn rather than as a row. Counting the raw timeline
 * therefore reports more events than the list can ever show, by exactly the
 * number of turns. Anywhere outside this file that puts a number on a run takes
 * it from here, so no two counts of the same run can disagree.
 */
export function counts(timeline: TimelineEntry[]): { rows: number; turns: number } {
  const turns = planTurns(timeline).length
  return { rows: timeline.length - turns, turns }
}

/**
 * Reads the turn structure back out of the arrival order. The console is handed
 * a flat timeline, so a turn is the stretch between one `request sent` and the
 * next, and its span runs to the last event that carried a time.
 *
 * The run clears the timeline before every request, so counting heads gives the
 * same numbers the labels carry.
 */
function planTurns(timeline: TimelineEntry[]): Turn[] {
  const turns: Turn[] = []

  for (const [index, entry] of timeline.entries()) {
    if (splitLabel(entry.label).name !== TURN_HEAD) continue

    const turn: Turn = {
      id: entry.id,
      number: turns.length + 1,
      headIndex: index,
      spanMs: 0,
      changed: false,
      paints: 0,
      closed: false,
      detail: entry.detail,
    }

    let endMs = entry.atMs
    for (let at = index + 1; at < timeline.length; at += 1) {
      const later = timeline[at]
      if (splitLabel(later.label).name === TURN_HEAD) {
        turn.closed = true
        break
      }
      if (later.atMs > 0) endMs = later.atMs
      if (later.label === EDIT_APPLIED) turn.changed = true
      if (splitLabel(later.label).name === PAINT) turn.paints += 1
      if (later.label === RUN_END) turn.closed = true
    }

    turn.spanMs = endMs - entry.atMs
    turns.push(turn)
  }

  return turns
}

/** Where a row sits in the full timeline, which is what decides its turn. */
function leadIndex(row: EntryRow | Group, stamps: Map<string, Stamp>): number {
  const lead = row.kind === 'group' ? row.entries[0] : row.entry
  return stamps.get(lead.id)?.index ?? 0
}

/**
 * Cuts the list into one section per turn.
 *
 * A turn whose rows were all filtered out opens no section, so a heading never
 * announces an empty stretch. Skipping straight to the newest turn that opened
 * before a row is what does that, and it also keeps the separator honest under
 * folding, where one row can stand for many.
 */
function sectioned(
  rows: (EntryRow | Group)[],
  turns: Turn[],
  stamps: Map<string, Stamp>,
): Section[] {
  const sections: Section[] = []
  let next = 0
  let current: Section | undefined

  for (const row of rows) {
    const at = leadIndex(row, stamps)
    let opened: Turn | undefined
    while (next < turns.length && turns[next].headIndex <= at) opened = turns[next++]

    if (opened || !current) {
      current = { id: opened ? `turn-${opened.id}` : 'prelude', turn: opened, rows: [] }
      sections.push(current)
    }
    current.rows.push(row)
  }

  return sections
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

function fold(entries: TimelineEntry[], stamps: Map<string, Stamp>): (EntryRow | Group)[] {
  const rows: (EntryRow | Group)[] = []
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
