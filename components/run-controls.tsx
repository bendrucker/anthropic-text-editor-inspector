import { MODELS, findModel, EFFORTS, findEffort, type EffortChoice } from '@/lib/models'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Tooltip } from './ui/tooltip'
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
      <Select value={model} onValueChange={onModel} disabled={disabled}>
        <SelectTrigger aria-label="Model">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODELS.map((option) => (
            <SelectItem key={option.id} value={option.id} label={option.label} note={option.note} />
          ))}
        </SelectContent>
      </Select>

      <Tooltip
        disabled={!effortAvailable}
        content={
          effortAvailable ? undefined : (
            <>
              {choice?.label ?? 'This model'} rejects <code>output_config.effort</code>, so there is
              nothing here to set. Switch to a model that accepts it to control how much the model
              reasons before it commits to an edit.
            </>
          )
        }
      >
        <Select
          value={effort}
          onValueChange={(next) => onEffort(next as EffortChoice['id'])}
          disabled={disabled || !effortAvailable}
        >
          <SelectTrigger aria-label="Effort">
            Effort: <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EFFORTS.map((option) => (
              <SelectItem key={option.id} value={option.id} label={option.label} note={option.note} />
            ))}
          </SelectContent>
        </Select>
      </Tooltip>

      <Tooltip
        disabled={disabled || !fastAvailable}
        content={
          fastAvailable ? (
            <>
              The same model at a higher output rate, billed at a premium. It is the one control
              here aimed at the wait before the first byte rather than at what the model writes.
            </>
          ) : (
            <>
              Fast mode is a research preview limited to the Opus 5 family, so{' '}
              {choice?.label ?? 'this model'} cannot run it. Switch to Opus 5 to compare a fast run
              against a standard one.
            </>
          )
        }
      >
        <button
          onClick={() => onFastMode(!fastMode)}
          aria-pressed={fastMode}
          disabled={disabled || !fastAvailable}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
            fastMode
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
          }`}
        >
          Fast
        </button>
      </Tooltip>
    </div>
  )
}

/** Recent runs, so a demo can compare configurations rather than assert a number. */
export function RunHistory({ runs }: { runs: Run[] }) {
  if (runs.length === 0) {
    return (
      <div className="px-4 py-3">
        <p className="text-[11px] text-slate-500">
          Each finished run lands here, so two configurations can be compared rather than described.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 overflow-y-auto px-4 py-3">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
        Time to first edit
      </p>
      <ul className="space-y-1">
        {runs.slice(0, 5).map((run, index) => (
          <li key={index} className="text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-slate-600">
                {findModel(run.model)?.label ?? run.model}
                <span className="ml-1 text-slate-500">{findEffort(run.effort)?.label.toLowerCase()}</span>
                {run.fastMode && <span className="ml-1 text-amber-700">fast</span>}
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
  {
    key: 'connect',
    tone: 'bg-slate-300',
    explanation: (
      <>
        The request leaving the browser to the first byte coming back: network round trip plus model
        start-up. Nothing the model writes has happened yet, so no prompt or tool setting shortens
        it. Fast mode is the control aimed here.
      </>
    ),
  },
  {
    key: 'preamble',
    tone: 'bg-amber-300',
    explanation: (
      <>
        The first byte to the tool block opening. This is everything the model produced before it
        committed to an edit. Effort is the control aimed here: raise it and the model deliberates
        longer before reaching for the tool.
      </>
    ),
  },
  {
    key: 'target',
    tone: 'bg-blue-400',
    explanation: (
      <>
        The tool block opening to <code>old_str</code> closing. The model is spelling out the exact
        text it wants to replace, and the document cannot highlight anything until that string
        lands. Its length is set by how much surrounding context the model needed to make the match
        unique.
      </>
    ),
  },
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
      {/* The bar is the three numbers printed underneath it, drawn to scale. */}
      <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
        {SEGMENTS.map((segment) => (
          <Tooltip key={segment.key} content={segment.explanation} side="top">
            <div
              className={segment.tone}
              style={{ width: `${(spans[segment.key as keyof typeof spans] / total) * 100}%` }}
            />
          </Tooltip>
        ))}
      </div>
      <div className="flex gap-3 text-[11px] tabular-nums text-slate-600">
        {/* The legend is where a keyboard reaches the explanation the bar carries. */}
        {SEGMENTS.map((segment) => (
          <Tooltip key={segment.key} content={segment.explanation} side="top">
            <span
              tabIndex={0}
              className="rounded-xs focus-visible:outline-2 focus-visible:outline-slate-500"
            >
              {segment.key} {(spans[segment.key as keyof typeof spans] / 1000).toFixed(2)}s
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
