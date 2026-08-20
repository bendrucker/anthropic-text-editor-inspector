import { MODELS, findModel, EFFORTS, type EffortChoice } from '@/lib/models'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Tooltip } from './ui/tooltip'

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
