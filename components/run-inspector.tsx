import { useEffect, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type { BufferState, TimelineEntry } from '@/lib/timeline'
import type { Match } from '@/lib/str-replace'
import type { Probe } from '@/lib/traps'
import { MatchSandbox } from './match-sandbox'

interface RunInspectorProps {
  timeline: TimelineEntry[]
  buffer: BufferState | null
  canonical: () => string
  probes: Probe[]
  onShowMatches: (matches: Match[]) => void
  onReplay: (speed?: number) => void
  replaying: boolean
  recorded: boolean
}

type Panel = 'buffer' | 'matcher'

/**
 * The two streams side by side: what arrived on the wire, and what the app did
 * about it. Reading the interleaving is the point, so neither gets its own tab.
 */
export function RunInspector({
  timeline,
  buffer,
  canonical,
  probes,
  onShowMatches,
  onReplay,
  replaying,
  recorded,
}: RunInspectorProps) {
  const [open, setOpen] = useState(true)
  const [panel, setPanel] = useState<Panel>('buffer')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [timeline])

  return (
    <section className="flex shrink-0 flex-col border-t border-slate-200 bg-slate-50">
      <div className="flex shrink-0 items-center justify-between px-5 py-2">
        <span className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-slate-700">Run inspector</span>
          <span className="text-[11px] text-slate-400">
            {timeline.length === 0
              ? 'wire events and what the app did about them'
              : `${timeline.length} event${timeline.length === 1 ? '' : 's'}`}
            {replaying && ' · replaying at quarter speed'}
          </span>
        </span>

        <span className="flex items-center gap-3">
          {recorded && (
            <button
              onClick={() => onReplay(replaying ? undefined : 0.25)}
              disabled={replaying}
              title="Replays the recorded run through the same handlers at a quarter speed. The live path is untouched."
              className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 disabled:opacity-40"
            >
              {replaying ? 'Replaying…' : 'Replay at 0.25x'}
            </button>
          )}
          <button onClick={() => setOpen((prior) => !prior)} className="text-xs text-slate-400">
            {open ? 'Hide' : 'Show'}
          </button>
        </span>
      </div>

      {open && (
        <div className="grid h-56 grid-cols-[1fr_340px] overflow-hidden border-t border-slate-200">
          <div ref={scrollRef} className="min-h-0 overflow-y-auto px-5 py-2">
            {timeline.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">
                Ask for an edit. Every event that crosses the wire lands here.
              </p>
            ) : (
              <ol className="space-y-0.5">
                {timeline.map((entry) => (
                  <Row key={entry.id} entry={entry} />
                ))}
              </ol>
            )}
          </div>

          <Tabs.Root
            value={panel}
            onValueChange={(next) => setPanel(next as Panel)}
            className="flex min-h-0 flex-col border-l border-slate-200"
          >
            <Tabs.List className="flex shrink-0 gap-1 border-b border-slate-200 px-3 py-1.5">
              <PanelTab value="buffer">Input buffer</PanelTab>
              <PanelTab value="matcher">Matcher</PanelTab>
            </Tabs.List>

            <Tabs.Content value="buffer" className="flex min-h-0 flex-1 flex-col">
              <BufferPanel buffer={buffer} />
            </Tabs.Content>
            <Tabs.Content value="matcher" className="flex min-h-0 flex-1 flex-col">
              <MatchSandbox canonical={canonical} probes={probes} onShowMatches={onShowMatches} />
            </Tabs.Content>
          </Tabs.Root>
        </div>
      )}
    </section>
  )
}

function PanelTab({ value, children }: { value: Panel; children: string }) {
  return (
    <Tabs.Trigger
      value={value}
      className="rounded px-2 py-0.5 text-[11px] font-medium text-slate-400 transition hover:text-slate-600 data-[state=active]:bg-slate-200 data-[state=active]:text-slate-700"
    >
      {children}
    </Tabs.Trigger>
  )
}

const TONES = {
  good: 'text-emerald-700',
  bad: 'text-amber-700',
  normal: 'text-slate-700',
}

function Row({ entry }: { entry: TimelineEntry }) {
  const wire = entry.source === 'wire'

  return (
    <li className="flex gap-3 py-0.5 text-[11px] leading-relaxed">
      <span className="w-12 shrink-0 text-right tabular-nums text-slate-400">
        {(entry.atMs / 1000).toFixed(2)}s
      </span>
      <span
        className={`w-8 shrink-0 font-medium ${wire ? 'text-blue-500' : 'text-slate-400'}`}
        title={wire ? 'Arrived on the wire' : 'A decision this app made'}
      >
        {wire ? 'wire' : 'app'}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`font-mono ${TONES[entry.tone ?? 'normal']}`}>{entry.label}</span>
        {entry.raw !== undefined && (
          <span className="ml-2 rounded bg-white px-1 py-0.5 font-mono text-slate-500">
            {JSON.stringify(entry.raw)}
          </span>
        )}
        {entry.detail && <span className="ml-2 text-slate-400">{entry.detail}</span>}
      </span>
    </li>
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
        <p className="text-[11px] text-slate-400">
          The tool-input buffer appears here as fragments arrive.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-4 py-3">
      <div>
        <p className="mb-1 text-[11px] font-medium text-slate-500">
          Accumulated buffer · {buffer.fragments} fragments · {buffer.buffer.length} chars
        </p>
        <pre className="max-h-24 overflow-auto rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-slate-600">
          {buffer.buffer}
        </pre>
      </div>

      <Field label="old_str" value={buffer.oldStr} complete={buffer.oldStrComplete} />
      <Field label="new_str" value={buffer.newStr} complete={buffer.newStrComplete} />

      <p className="text-[10px] leading-relaxed text-slate-400">
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
        <span className={complete ? 'text-emerald-600' : 'text-blue-500'}>
          {value === undefined ? 'not started' : complete ? 'closed' : 'streaming'}
        </span>
        {value !== undefined && <span className="text-slate-400">{value.length} chars</span>}
      </p>
      <pre className="max-h-20 overflow-auto rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-slate-700">
        {value ?? ''}
      </pre>
    </div>
  )
}
