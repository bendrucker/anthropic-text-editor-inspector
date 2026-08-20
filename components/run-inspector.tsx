import { useCallback, useMemo, useState, type ReactNode } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
// `Panel` is aliased because this file already calls the tabbed column a panel.
import {
  Group,
  Panel as SplitPanel,
  Separator,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels'
import type { BufferState, TimelineEntry } from '@/lib/timeline'
import type { Match } from '@/lib/str-replace'
import type { Probe } from '@/lib/traps'
import type { Run } from '@/hooks/use-live-document'
import { EventConsole, counts } from './event-console'
import { Tooltip } from './ui/tooltip'
import { MatchSandbox } from './match-sandbox'
import { RunHistory } from './run-summary'

interface RunInspectorProps {
  timeline: TimelineEntry[]
  buffer: BufferState | null
  canonical: () => string
  probes: Probe[]
  runs: Run[]
  onShowMatches: (matches: Match[]) => void
  onReplay: (speed?: number) => void
  replaying: boolean
  recorded: boolean
}

type Panel = 'buffer' | 'matcher' | 'runs'

/**
 * The console's event grid costs this much before Detail gets a pixel: four
 * fixed columns, the four gaps between them and the row padding. Detail is
 * `minmax(0,1fr)` on top of that, so it has no floor of its own and truncates
 * by design, with the full text one click into the expansion panel.
 *
 * #64 arrived at it as arithmetic: `3.75rem`, `3.75rem`, `2.25rem` and
 * `10.5rem` of track, four `gap-x-2` gaps and the row's `px-3`. Held at
 * decreasing widths the header's last column first crosses the edge at 359px,
 * so the number carries about 20px over where the console visibly breaks, which
 * is what a floor is for.
 */
const CONSOLE_FLOOR = 380

/**
 * Everything in the tabbed column wraps except the tab strip, so the strip is
 * the column's min-content. Held at decreasing widths with a run in the list,
 * the Runs trigger crosses the edge at 171px, and it is the strip rather than
 * anything drawn under it that gives out first: the buffer's blocks wrap, the
 * matcher's controls wrap, and the run bar is a percentage track inside an
 * `overflow-hidden` rail whose segments floor at 3px each. All three tabs
 * measure the same 172px for that reason.
 *
 * 200px is that measurement with room for the one part of the strip that grows,
 * the run count in the Runs label. Each further digit costs about 6px at
 * `text-[11px]`, so this holds well past any run count a session reaches.
 */
const PANELS_FLOOR = 200

/** The rule the separator draws, which used to be the panel column's `border-l`. */
const SEPARATOR_WIDTH = 1

/**
 * Where the split sits when nothing has been dragged, and what the tabs were
 * fixed at before they could move.
 */
const PANELS_DEFAULT = 340

/**
 * The separator is one pixel wide and the pointer should not have to find one
 * pixel. The library hit-tests a band this wide centred on the rule, so the
 * target grows without the rule getting heavier. 12px puts 6px either side,
 * which on the panel side stays inside the tab list's own `px-3` and so never
 * takes a click that was meant for a tab.
 */
const HIT_TARGET = { coarse: 24, fine: 12 }

/**
 * The two streams side by side: what arrived on the wire, and what the app did
 * about it. Reading the interleaving is the point, so neither gets its own tab.
 */
export function RunInspector({
  timeline,
  buffer,
  canonical,
  probes,
  runs,
  onShowMatches,
  onReplay,
  replaying,
  recorded,
}: RunInspectorProps) {
  const [open, setOpen] = useState(true)
  const [panel, setPanel] = useState<Panel>('buffer')
  const { rows, turns } = useMemo(() => counts(timeline), [timeline])

  // A split the reader has to set again on every load is worse than one they
  // cannot set at all, so it is remembered. Only their own drags and key
  // presses are written back: a narrow window clamps the split on its way past
  // the floors, and saving that would let a resize quietly eat a preference the
  // reader never changed.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'run-inspector-split',
    onlySaveAfterUserInteractions: true,
  })

  // The width the panel column was last *given*, as opposed to the width it
  // happens to have. The group is floored at the console's floor plus this, so
  // a viewport too narrow for the chosen split scrolls rather than overwriting
  // it. Squeezing would be the quieter answer and is the wrong one: the panel
  // comes back from a scroll, and it does not come back from a clamp. Dragging
  // the window narrow and wide again would silently cost the reader the split
  // they set, with nothing to undo.
  //
  // Only a drag or a key press moves this, so it cannot chase its own tail
  // through the min-width it feeds.
  const panelsRef = usePanelRef()
  const [chosen, setChosen] = useState(PANELS_DEFAULT)
  const remember = useCallback(() => {
    const size = panelsRef.current?.getSize()
    if (size) setChosen(Math.round(size.inPixels))
  }, [panelsRef])

  const layoutChanged = useCallback(
    (
      layout: Parameters<typeof onLayoutChanged>[0],
      meta: Parameters<typeof onLayoutChanged>[1],
    ) => {
      onLayoutChanged(layout, meta)
      if (meta.isUserInteraction) remember()
    },
    [onLayoutChanged, remember],
  )

  return (
    <section
      aria-label="Run inspector"
      className="flex shrink-0 flex-col border-t border-slate-200 bg-slate-50"
    >
      <div className="flex shrink-0 items-center justify-between px-5 py-2">
        <span className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-slate-700">Run inspector</span>
          {/* Both numbers, because either alone is one the console contradicts.
              The timeline's length counts the requests the console draws as
              separators rather than rows, so it is larger than anything the
              list can show. The row count alone leaves those requests
              unaccounted for. */}
          <span className="text-[11px] text-slate-500">
            {timeline.length === 0
              ? 'wire events and what the app did about them'
              : `${rows} event${rows === 1 ? '' : 's'}`}
            {turns > 0 && ` · ${turns} turn${turns === 1 ? '' : 's'}`}
            {replaying && ' · replaying at quarter speed'}
          </span>
        </span>

        <span className="flex items-center gap-3">
          {recorded && (
            <Tooltip
              disabled={replaying}
              side="top"
              content={
                replaying ? (
                  <>
                    The replay is already running. It finishes on its own, and the button comes back
                    when it does.
                  </>
                ) : (
                  <>
                    Feeds the recorded events back through the same handlers at a quarter speed, so
                    the fragment-by-fragment arrival that a live run finishes in a second can be
                    read. Nothing is re-requested and the live path is untouched.
                  </>
                )
              }
            >
              <button
                onClick={() => onReplay(replaying ? undefined : 0.25)}
                disabled={replaying}
                className="rounded-md border border-control bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:border-control-strong disabled:opacity-40"
              >
                {replaying ? 'Replaying…' : 'Replay at 0.25x'}
              </button>
            </Tooltip>
          )}
          <button
            onClick={() => setOpen((prior) => !prior)}
            aria-expanded={open}
            aria-controls={open ? 'run-inspector-panels' : undefined}
            className="text-xs text-slate-500"
          >
            {open ? 'Hide' : 'Show'}
          </button>
        </span>
      </div>

      {open && (
        // Floored at the height the drawer has always had, so a laptop loses
        // nothing, and proportional above it. One fixed number takes half a
        // short screen and a fifth of a tall one, and every timeline entry
        // added makes the tall case worse.
        <div
          id="run-inspector-panels"
          // Where the split sits is the reader's business. Whether it fits is
          // arithmetic: the console's floor plus the width the panel column was
          // given is the least the pair can be laid out in, and the group
          // carries that as its `min-width`. So this element scrolls at exactly
          // the viewport where the chosen split stops being possible, and a
          // reader who narrows the panel moves that point down with them.
          //
          // `hidden` cut the panel off at its right edge with nothing to say
          // so, and focusing a tab inside it scrolled the console away with no
          // way to scroll back. Scrolling only takes over once the width to
          // lay both out side by side is genuinely gone.
          className="h-[clamp(18rem,34vh,32.5rem)] overflow-x-auto overflow-y-hidden border-t border-slate-200"
        >
          <Group
            id="run-inspector-split"
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={layoutChanged}
            resizeTargetMinimumSize={HIT_TARGET}
            style={{
              minWidth: CONSOLE_FLOOR + SEPARATOR_WIDTH + Math.max(chosen, PANELS_FLOOR),
            }}
          >
            {/* Both panels clip rather than scroll. The library gives a panel
                `overflow: auto`, which would answer a column that is one pixel
                too narrow with a scrollbar instead of a wider column. The
                floors below are what keeps that from happening, and a panel
                that cannot honour them should be visibly wrong, not quietly
                scrollable. */}
            <SplitPanel
              id="console"
              minSize={`${CONSOLE_FLOOR}px`}
              className="flex min-h-0 flex-col"
              style={{ overflow: 'hidden' }}
            >
              <EventConsole timeline={timeline} />
            </SplitPanel>

            {/* The rule this draws is the `border-l` the panel column used to
                carry, in `control` rather than `slate-200`: #63 spends that
                token on an edge a reader has to find in order to operate it,
                and dragging this one is now the only way to change the split.
                It darkens further on hover, focus and drag.

                The focus ring is the app's own, and the group clips its top and
                bottom strokes against the drawer's edges. What survives is the
                pair of vertical strokes, which is the part of the ring that
                marks a vertical rule anyway. */}
            <Separator
              aria-label="Resize the event console"
              className="focus-ring w-px cursor-col-resize bg-control transition-colors data-[separator=active]:bg-control-strong data-[separator=focus]:bg-control-strong data-[separator=hover]:bg-control-strong"
            />

            <SplitPanel
              id="panels"
              panelRef={panelsRef}
              defaultSize={`${PANELS_DEFAULT}px`}
              minSize={`${PANELS_FLOOR}px`}
              // A saved split arrives as a percentage of a group whose width
              // this panel is about to change, so the first size it settles on
              // is the one to remember. Later calls are the console absorbing a
              // window resize, which is not a choice anyone made.
              onResize={(size, _id, previous) => {
                if (previous === undefined) setChosen(Math.round(size.inPixels))
              }}
              // A wider window should widen the console, which is where the
              // rows are, and leave the tabs the width they were given. That is
              // what the fixed track used to do for free.
              groupResizeBehavior="preserve-pixel-size"
              className="flex min-h-0 flex-col"
              style={{ overflow: 'hidden' }}
            >
              <Tabs.Root
                value={panel}
                onValueChange={(next) => setPanel(next as Panel)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <Tabs.List className="flex shrink-0 gap-1 border-b border-slate-200 px-3 py-1.5">
                  <PanelTab value="buffer">Input buffer</PanelTab>
                  <PanelTab value="matcher">Matcher</PanelTab>
                  {/* Run telemetry belongs with the timeline it summarises. In a
                      tab it also scrolls, so five runs cannot squeeze the panel
                      it shares a column with. */}
                  <PanelTab value="runs">Runs{runs.length > 0 && ` · ${runs.length}`}</PanelTab>
                </Tabs.List>

                <Tabs.Content value="buffer" className="flex min-h-0 flex-1 flex-col">
                  <BufferPanel buffer={buffer} />
                </Tabs.Content>
                <Tabs.Content value="matcher" className="flex min-h-0 flex-1 flex-col">
                  <MatchSandbox
                    canonical={canonical}
                    probes={probes}
                    onShowMatches={onShowMatches}
                  />
                </Tabs.Content>
                <Tabs.Content value="runs" className="flex min-h-0 flex-1 flex-col">
                  <RunHistory runs={runs} />
                </Tabs.Content>
              </Tabs.Root>
            </SplitPanel>
          </Group>
        </div>
      )}
    </section>
  )
}

function PanelTab({ value, children }: { value: Panel; children: ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="rounded px-2 py-0.5 text-[11px] font-medium text-slate-500 transition hover:text-slate-700 data-[state=active]:bg-slate-200 data-[state=active]:text-slate-700"
    >
      {children}
    </Tabs.Trigger>
  )
}

/**
 * The accumulated tool input, which is not valid JSON for most of its life. The
 * scanner reads fields out of it anyway, which is what makes streaming possible.
 */
function BufferPanel({ buffer }: { buffer: BufferState | null }) {
  if (!buffer) {
    return (
      <div className="px-4 py-3">
        <p className="text-[11px] text-slate-500">
          The tool-input buffer appears here as fragments arrive.
        </p>
      </div>
    )
  }

  return (
    // The panel is the only scroller in this column. Capping the blocks inside
    // it would put a scrollbar inside a scrollbar inside a column the reader
    // can drag down to 200px.
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-4 py-3">
      <div>
        <p className="mb-1 text-[11px] font-medium text-slate-500">
          Accumulated buffer · {buffer.fragments} fragments · {buffer.buffer.length} chars
        </p>
        <pre className="rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-slate-600">
          {buffer.buffer}
        </pre>
      </div>

      <Field label="old_str" value={buffer.oldStr} complete={buffer.oldStrComplete} />
      <Field label="new_str" value={buffer.newStr} complete={buffer.newStrComplete} />

      <p className="text-[10px] leading-relaxed text-slate-600">
        Declared before <span className="font-mono">new_str</span> in the schema, so{' '}
        <span className="font-mono">old_str</span> closes first and the target is known while the
        replacement is still arriving.
      </p>
    </div>
  )
}

function Field({ label, value, complete }: { label: string; value?: string; complete: boolean }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-500">
        <span className="font-mono">{label}</span>
        <span className={complete ? 'text-emerald-700' : 'text-blue-600'}>
          {value === undefined ? 'not started' : complete ? 'closed' : 'streaming'}
        </span>
        {value !== undefined && <span className="text-slate-600">{value.length} chars</span>}
      </p>
      <pre className="rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-700">
        {value ?? ''}
      </pre>
    </div>
  )
}
