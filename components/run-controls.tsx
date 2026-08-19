import { MODELS, findModel, EFFORTS, findEffort, type EffortChoice } from '@/lib/models'
import type { EditTiming } from '@/lib/agent'
import type { Run } from '@/hooks/use-live-document'

interface RunControlsProps {
  model: string
  onModel: (model: string) => void
  fastMode: boolean
  onFastMode: (enabled: boolean) => void
  fastAvailable: boolean
  effort: EffortChoice['id']
  onEffort: (effort: EffortChoice['id']) => void
  effortAvailable: boolean
  disabled: boolean
}

export function RunControls({
  model,
  onModel,
  fastMode,
  onFastMode,
  fastAvailable,
  effort,
  onEffort,
  effortAvailable,
  disabled,
}: RunControlsProps) {
  const choice = findModel(model)

  return (
    <div className="flex items-center gap-2">
      <select
        value={model}
        disabled={disabled}
        onChange={(event) => onModel(event.target.value)}
        title={choice?.note}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 focus:outline-none disabled:opacity-50"
      >
        {MODELS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        value={effort}
        disabled={disabled || !effortAvailable}
        onChange={(event) => onEffort(event.target.value as EffortChoice['id'])}
        title={
          effortAvailable
            ? findEffort(effort)?.note
            : `${choice?.label ?? 'This model'} does not accept an effort setting`
        }
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 focus:outline-none disabled:opacity-50"
      >
        {EFFORTS.map((option) => (
          <option key={option.id} value={option.id}>
            Effort: {option.label}
          </option>
        ))}
      </select>

      <button
        onClick={() => onFastMode(!fastMode)}
        disabled={disabled || !fastAvailable}
        title={
          fastAvailable
            ? 'Fast mode: same model, higher output rate, premium pricing'
            : `Fast mode is not available on ${choice?.label ?? 'this model'}`
        }
        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
          fastMode
            ? 'border-amber-300 bg-amber-50 text-amber-800'
            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
        }`}
      >
        Fast
      </button>
    </div>
  )
}

/** Recent runs, so a demo can compare configurations rather than assert a number. */
export function RunHistory({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return null

  return (
    <div className="border-t border-slate-200 px-5 py-3">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
        Time to first edit
      </p>
      <ul className="space-y-1">
        {runs.slice(0, 5).map((run, index) => (
          <li key={index} className="text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-slate-500">
                {findModel(run.model)?.label ?? run.model}
                <span className="ml-1 text-slate-400">{findEffort(run.effort)?.label.toLowerCase()}</span>
                {run.fastMode && <span className="ml-1 text-amber-600">fast</span>}
              </span>
              <span className="shrink-0 font-medium tabular-nums text-slate-700">
                {run.timeToFirstEditMs === null ? 'no edit' : `${(run.timeToFirstEditMs / 1000).toFixed(2)}s`}
              </span>
            </div>
            {run.timing && <Breakdown timing={run.timing} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Splits the wait into the three things that shorten independently, so a control
 * change can be traced to the segment it moved.
 */
const SEGMENTS = [
  { key: 'connect', tone: 'bg-slate-300', title: 'Request out to first byte back. Network and model start-up. Fast mode moves this.' },
  { key: 'preamble', tone: 'bg-amber-300', title: 'First byte to the tool block opening. Text the model wrote before committing to an edit. Effort moves this.' },
  { key: 'target', tone: 'bg-blue-400', title: 'Tool block open to old_str closing. The model spelling out the text it wants to replace. Nothing can render until it lands.' },
]

function Breakdown({ timing }: { timing: EditTiming }) {
  const spans = {
    connect: timing.firstByteMs,
    preamble: Math.max(timing.toolStartMs - timing.firstByteMs, 0),
    target: Math.max(timing.targetMs - timing.toolStartMs, 0),
  }
  const total = Math.max(timing.targetMs, 1)

  return (
    <div className="mt-1 space-y-1">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
        {SEGMENTS.map((segment) => (
          <div
            key={segment.key}
            title={segment.title}
            className={segment.tone}
            style={{ width: `${(spans[segment.key as keyof typeof spans] / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex gap-3 text-[11px] tabular-nums text-slate-400">
        {SEGMENTS.map((segment) => (
          <span key={segment.key} title={segment.title}>
            {segment.key} {(spans[segment.key as keyof typeof spans] / 1000).toFixed(2)}s
          </span>
        ))}
      </div>
    </div>
  )
}
