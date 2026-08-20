import { useState, type ReactNode } from 'react'
import { findModel, findEffort } from '@/lib/models'
import { Tooltip } from './ui/tooltip'
import type { EditTiming } from '@/lib/agent'
import type { Run } from '@/hooks/use-live-document'

/**
 * What a run spent, and how little of it reached the screen.
 *
 * Two bars rather than one, because the app's own contribution is routinely a
 * few percent of wall clock. A bar scaled to the whole run makes that invisible
 * and a bar scaled to the wait cuts off before it happens. The second bar is
 * the first one's render segment expanded, tied to it by colour and by a
 * printed zoom factor rather than by an axis break the reader has to learn.
 *
 * Wherever nothing happened, nothing is drawn. The tail is most of a run and
 * bought no visible change, so it gets its honest width as bare track and no
 * ink, which is also why nothing in it can be mistaken for the app being slow.
 */

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`
const brief = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : secs(ms))
const countOf = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** How far right the bar has to reach. A late commit can settle after the run ends. */
function extentOf(timing: EditTiming): number {
  return Math.max(timing.totalMs ?? timing.targetMs, timing.settledMs ?? 0, 1)
}

function spansOf(timing: EditTiming) {
  const retries = timing.retriesMs ?? 0
  return {
    retries,
    // `firstByteMs` is measured from the run, so on a retry it covers every
    // preceding turn as well. Subtracting the retry span is what keeps a second
    // attempt from being reported as a slow network.
    connect: Math.max(timing.firstByteMs - retries, 0),
    preamble: Math.max(timing.toolStartMs - timing.firstByteMs, 0),
    target: Math.max(timing.targetMs - timing.toolStartMs, 0),
    render: Math.max((timing.settledMs ?? timing.targetMs) - timing.targetMs, 0),
  }
}

type SpanKey = keyof ReturnType<typeof spansOf>

const TONES: Record<SpanKey, string> = {
  retries: 'bg-slate-300',
  connect: 'bg-slate-300',
  preamble: 'bg-amber-300',
  target: 'bg-blue-400',
  render: 'bg-emerald-500',
}

/**
 * Every segment leads with its share and then says whether its lever can be
 * reached in this run's configuration. Naming a control the run cannot use is
 * worse than naming none, and the segment that dominates having no reachable
 * lever is the lesson rather than an omission.
 */
function explain(key: SpanKey, run: Run, timing: EditTiming): ReactNode {
  const spans = spansOf(timing)
  const model = findModel(run.model)
  const name = model?.label ?? run.model
  const share = (ms: number, of: number) => `${Math.round((ms / Math.max(of, 1)) * 100)}%`
  const wait = Math.max(timing.targetMs, 1)

  if (key === 'retries') {
    return (
      <>
        {brief(spans.retries)} spent before the turn that landed this edit, across{' '}
        {countOf((timing.turn ?? 1) - 1, 'earlier turn')}. This is network and model time paid twice.
        A run reaches it by asking for an edit the document cannot satisfy, which is what the traps
        and the guardrails switch are for.
      </>
    )
  }
  if (key === 'connect') {
    return (
      <>
        {brief(spans.connect)}, {share(spans.connect, wait)} of the wait. The request leaving the
        browser to the first byte coming back: network round trip plus model start-up, before
        anything the model writes.{' '}
        {model?.supportsFast ? (
          <>Fast mode is the control aimed here.</>
        ) : (
          <>
            Fast mode is the only control aimed here, and {name} cannot run it. Nothing in this
            configuration shortens this segment.
          </>
        )}
      </>
    )
  }
  if (key === 'preamble') {
    return (
      <>
        {brief(spans.preamble)}, {share(spans.preamble, wait)} of the wait. Everything the model
        produced before it committed to an edit.{' '}
        {model?.supportsEffort ? (
          <>Effort is the control aimed here: raise it and the model deliberates longer.</>
        ) : (
          <>
            {name} rejects an effort setting, so there is no control aimed here in this
            configuration.
          </>
        )}
      </>
    )
  }
  if (key === 'target') {
    return (
      <>
        {brief(spans.target)}, {share(spans.target, wait)} of the wait. The tool block opening to{' '}
        <code>old_str</code> closing, {countOf(timing.oldStrChars ?? 0, 'character')} long. No switch
        shortens this. Asking for an edit whose target is shorter does, and a short target is also
        why a replacement can finish before anyone sees it stream.
      </>
    )
  }
  return (
    <>
      {brief(spans.render)}, {share(spans.render, extentOf(timing))} of the run. The app resolved the
      target at the left edge and the document finished changing at the right one. Everything to the
      left is the model and the network. Everything to the right is the model still talking.
    </>
  )
}

/**
 * The bar draws only where something happened, so the bare track to its right is
 * the tail. The tick marks where the run actually ended, which is what stops
 * that emptiness from reading as a bar that failed to fill.
 */
function RunBar({ run, timing, scaleMs }: { run: Run; timing: EditTiming; scaleMs: number }) {
  const spans = spansOf(timing)
  const keys: SpanKey[] = ['retries', 'connect', 'preamble', 'target', 'render']
  const endMs = timing.totalMs ?? timing.targetMs

  return (
    // `rounded-sm`, not a pill: a radius of half the height masks that much off
    // each end, which is wider than a small segment is drawn.
    <div aria-hidden className="relative h-2.5 overflow-hidden rounded-sm bg-slate-100">
      <div className="flex h-full">
        {keys.map((key) => {
          const ms = spans[key]
          if (ms <= 0) return null
          return (
            <Tooltip key={key} content={explain(key, run, timing)} side="top">
              {/* The one place the bar is not to scale. A segment under a pixel
                  reads as absent, and absent is the wrong word for the only
                  work this app does. */}
              <div
                className={`${TONES[key]} shrink-0`}
                style={{ width: `${(ms / scaleMs) * 100}%`, minWidth: '3px' }}
              />
            </Tooltip>
          )
        })}
      </div>
      {spans.retries > 0 && (
        // Retries and connect are the same kind of time, so they take the same
        // colour and a rule rather than a hue nobody has learned yet.
        <div
          className="absolute inset-y-0 w-px bg-white"
          style={{ left: `${(spans.retries / scaleMs) * 100}%` }}
        />
      )}
      <div
        className="absolute inset-y-0 w-px bg-slate-400"
        style={{ left: `calc(${Math.min((endMs / scaleMs) * 100, 100)}% - 1px)` }}
      />
    </div>
  )
}

/**
 * The render segment above, expanded.
 *
 * Three spans, because the middle one is neither. A tool that cannot stream its
 * input goes silent between the target closing and the replacement arriving, and
 * painting that stretch as landing would claim the app spent it rendering. It is
 * drawn as bare track for the same reason the tail is.
 */
function RenderBar({ timing }: { timing: EditTiming }) {
  const { targetMs, paintMs, settledMs, textPaintMs } = timing
  if (paintMs === undefined || settledMs === undefined) return null

  const window = Math.max(settledMs - targetMs, 1)
  const gap = Math.max(paintMs - targetMs, 0)
  const text = textPaintMs ?? null
  const waiting = text === null ? null : Math.max(text - paintMs, 0)
  const landing = text === null ? null : Math.max(settledMs - text, 0)
  const zoom = Math.max(Math.round(extentOf(timing) / window), 1)

  return (
    <div className="space-y-0.5">
      {/* Without a text paint there are no spans to draw, only a sliver and an
          empty track, which reads as a broken bar rather than a short one. */}
      {waiting !== null && landing !== null && (
        <div aria-hidden className="flex h-2.5 overflow-hidden rounded-sm bg-slate-100">
          <div
            className="shrink-0 bg-slate-400"
            style={{ width: `${(gap / window) * 100}%`, minWidth: '3px' }}
          />
          <div style={{ width: `${(waiting / window) * 100}%` }} />
          {landing > 0 && (
            <div
              className="shrink-0 bg-emerald-500"
              style={{ width: `${(landing / window) * 100}%`, minWidth: '3px' }}
            />
          )}
        </div>
      )}
      <p className="flex flex-wrap gap-x-2 text-[10px] tabular-nums text-slate-600">
        <Legend explanation="The app resolved the target here and a pixel moved there. This is the only span in the run that is the app's own overhead.">
          decide {brief(gap)}
        </Legend>
        {waiting !== null && waiting > 0 && (
          <Legend explanation="No replacement characters reached the screen here. A tool that cannot stream its input sends the whole replacement at once, so this span is the model still writing rather than the app rendering.">
            waiting {brief(waiting)}
          </Legend>
        )}
        {landing !== null && (
          <Legend explanation="The first replacement characters appearing to the last of them landing. This is what the streaming controls move, and it is bounded by how long the replacement takes to generate.">
            {landing > 0 ? `landing ${brief(landing)}` : 'landed in one frame'}
          </Legend>
        )}
        {waiting !== null && (
          <Legend explanation="The run bar above, magnified by this much. Printing it is what keeps two bars at different scales from reading as one.">
            ×{zoom}
          </Legend>
        )}
      </p>
    </div>
  )
}

/** Where a keyboard reaches an explanation the bar carries only on hover. */
function Legend({ explanation, children }: { explanation: ReactNode; children: ReactNode }) {
  return (
    <Tooltip content={explanation} side="top">
      <span tabIndex={0} className="rounded-xs focus-visible:outline-2 focus-visible:outline-slate-500">
        {children}
      </span>
    </Tooltip>
  )
}

/** What the run rendered, in words, since that is the question the app exists to answer. */
function headline(timing: EditTiming): string {
  const spans = spansOf(timing)
  const landed =
    timing.settledMs === undefined
      ? 'Nothing rendered'
      : timing.textPaintMs !== undefined && timing.settledMs === timing.textPaintMs
        ? 'Rendered in one frame'
        : `Rendered in ${brief(spans.render)}`
  return `${landed} after ${secs(timing.targetMs)} of model and network`
}

function tailLine(timing: EditTiming): string | null {
  const { settledMs, totalMs } = timing
  if (settledMs === undefined || totalMs === undefined) return null
  const tail = totalMs - settledMs
  if (tail <= 0) {
    return `The document finished changing ${brief(-tail)} after the run ended.`
  }
  // Not a bare percentage. The tail runs eight times longer on a path that
  // commits while streaming than on one that commits at the end of the turn, so
  // a share invites a comparison the numbers do not currently support.
  return `Stopped changing at ${secs(settledMs)}. The model kept going for ${brief(tail)} after the document was done.`
}

function RunRow({
  run,
  scaleMs,
  expanded,
  onOpen,
}: {
  run: Run
  scaleMs: number
  expanded: boolean
  onOpen: () => void
}) {
  const timing = run.timing
  const label = findModel(run.model)?.label ?? run.model
  const effort = findEffort(run.effort)?.label.toLowerCase()
  const spans = timing && spansOf(timing)
  const tail = timing?.settledMs !== undefined && timing.totalMs !== undefined
    ? Math.round(((timing.totalMs - timing.settledMs) / Math.max(timing.totalMs, 1)) * 100)
    : null

  return (
    <li className="text-xs">
      <button
        onClick={onOpen}
        aria-expanded={expanded}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        <span className="truncate text-slate-600">
          {label}
          <span className="ml-1 text-slate-500">{effort}</span>
          {run.fastMode && <span className="ml-1 text-amber-700">fast</span>}
        </span>
        <span className="shrink-0 tabular-nums text-slate-700">
          {spans ? <span className="font-medium">{brief(spans.render)}</span> : 'no edit'}
          {tail !== null && <span className="ml-1 text-slate-500">{tail}% tail</span>}
        </span>
      </button>

      {timing && (
        <div className="mt-1 space-y-1">
          {expanded && (
            <>
              <p className="text-[11px] text-slate-600">{headline(timing)}</p>
              {(timing.turn ?? 1) > 1 && (
                <p className="text-[10px] text-slate-500">
                  Reached the edit on turn {timing.turn}, after {secs(spansOf(timing).retries)} of{' '}
                  {countOf((timing.turn ?? 1) - 1, 'earlier attempt')}.
                </p>
              )}
            </>
          )}

          <RunBar run={run} timing={timing} scaleMs={scaleMs} />

          {expanded && (
            <>
              <p className="flex flex-wrap gap-x-2 text-[10px] tabular-nums text-slate-600">
                {(['connect', 'preamble', 'target'] as const).map((key) => (
                  <Legend key={key} explanation={explain(key, run, timing)}>
                    {key} {brief(spansOf(timing)[key])}
                  </Legend>
                ))}
              </p>
              <RenderBar timing={timing} />
              {tailLine(timing) && <p className="text-[10px] text-slate-500">{tailLine(timing)}</p>}
            </>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The panel is 340px wide in a viewport-clamped column, so it draws the newest
 * few runs and no more. The Runs tab counts every run kept, which is the larger
 * number once a demo passes this many, so the heading below names how many of
 * them reached the list rather than leaving the tab's count over a shorter one.
 */
const VISIBLE_RUNS = 5

/** Recent runs, so a demo can compare configurations rather than assert a number. */
export function RunHistory({ runs }: { runs: Run[] }) {
  const [opened, setOpened] = useState<Run | null>(null)

  if (runs.length === 0) {
    return (
      <div className="px-4 py-3">
        <p className="text-[11px] text-slate-500">
          Each finished run lands here, so two configurations can be compared rather than described.
        </p>
      </div>
    )
  }

  const shown = runs.slice(0, VISIBLE_RUNS)
  // One denominator for every row. A bar normalised to its own total draws a two
  // second run and a nine second run the same width, which is the opposite of
  // what a list of runs is for.
  const scaleMs = Math.max(...shown.map((run) => (run.timing ? extentOf(run.timing) : 1)), 1)

  return (
    <div className="min-h-0 overflow-y-auto px-4 py-3">
      <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
        Runs
        {shown.length < runs.length && (
          <span className="normal-case">
            {' '}
            · newest {shown.length} of {runs.length}
          </span>
        )}
      </p>
      <p className="mb-2 text-[10px] text-slate-500">
        First-byte latency varies by seconds between runs. Compare the render span, not the wait.
      </p>
      <ul className="space-y-2">
        {shown.map((run, index) => (
          <RunRow
            key={index}
            run={run}
            scaleMs={scaleMs}
            expanded={opened === null ? index === 0 : opened === run}
            onOpen={() => setOpened(run)}
          />
        ))}
      </ul>
    </div>
  )
}
