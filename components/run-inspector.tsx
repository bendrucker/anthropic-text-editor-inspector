import { useMemo, useState, type ReactNode } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
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
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 disabled:opacity-40"
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
          // Both panes have a floor: the console's toolbar sets one around 490px
          // and the panel column is 340px, so under about 830px they no longer
          // fit side by side. `hidden` cut the panel off at its right edge with
          // nothing to say so, and focusing a tab inside it scrolled the console
          // away with no way to scroll back. Narrowing the panel instead would
          // buy the width from the console's Detail column, which is the one
          // that has to stay readable.
          className="grid h-[clamp(18rem,34vh,32.5rem)] grid-cols-[1fr_340px] overflow-x-auto overflow-y-hidden border-t border-slate-200"
        >
          <EventConsole timeline={timeline} />

          <Tabs.Root
            value={panel}
            onValueChange={(next) => setPanel(next as Panel)}
            className="flex min-h-0 flex-col border-l border-slate-200"
          >
            <Tabs.List className="flex shrink-0 gap-1 border-b border-slate-200 px-3 py-1.5">
              <PanelTab value="buffer">Input buffer</PanelTab>
              <PanelTab value="matcher">Matcher</PanelTab>
              {/* Run telemetry belongs with the timeline it summarises. In a tab
                  it also scrolls, so five runs cannot squeeze the panel it
                  shares a column with. */}
              <PanelTab value="runs">Runs{runs.length > 0 && ` · ${runs.length}`}</PanelTab>
            </Tabs.List>

            <Tabs.Content value="buffer" className="flex min-h-0 flex-1 flex-col">
              <BufferPanel buffer={buffer} />
            </Tabs.Content>
            <Tabs.Content value="matcher" className="flex min-h-0 flex-1 flex-col">
              <MatchSandbox canonical={canonical} probes={probes} onShowMatches={onShowMatches} />
            </Tabs.Content>
            <Tabs.Content value="runs" className="flex min-h-0 flex-1 flex-col">
              <RunHistory runs={runs} />
            </Tabs.Content>
          </Tabs.Root>
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
    // it would put a scrollbar inside a scrollbar inside 340px.
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
