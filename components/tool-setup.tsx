interface ToolSetupProps {
  guardrails: boolean
  onGuardrails: (on: boolean) => void
  oldStrFirst: boolean
  onOldStrFirst: (on: boolean) => void
  eagerStreaming: boolean
  onEagerStreaming: (on: boolean) => void
  disabled: boolean
}

interface Switch {
  key: 'guardrails' | 'oldStrFirst' | 'eagerStreaming'
  label: string
  /** What the run does when the switch is off, which is the interesting half. */
  offLabel: string
  title: string
}

const SWITCHES: Switch[] = [
  {
    key: 'guardrails',
    label: 'Prompt rules',
    offLabel: 'Prompt rules off',
    title:
      'On, the system prompt pre-teaches uniqueness and table padding and the model rarely trips. Off, it learns the same constraints from tool results, so the retry loop actually runs.',
  },
  {
    key: 'oldStrFirst',
    label: 'old_str first',
    offLabel: 'new_str first',
    title:
      'Models emit tool input in schema order. Declaring old_str first means the target is known while the replacement streams. Flip it and the document sits inert until the very end. Order-follows-schema is observed behavior, not a spec guarantee.',
  },
  {
    key: 'eagerStreaming',
    label: 'Eager streaming',
    offLabel: 'Eager streaming off',
    title:
      'On, unvalidated input_json_delta fragments arrive as the model types them. Off, tool input lands in validated bursts and nothing can render early.',
  },
]

/**
 * The tool's own configuration, kept on screen rather than buried in code,
 * because every switch here changes something the inspector will show.
 */
export function ToolSetup(props: ToolSetupProps) {
  const setters = {
    guardrails: props.onGuardrails,
    oldStrFirst: props.onOldStrFirst,
    eagerStreaming: props.onEagerStreaming,
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-6 py-1.5">
      <span className="mr-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
        Tool setup
      </span>

      {SWITCHES.map((entry) => {
        const on = props[entry.key]

        return (
          <button
            key={entry.key}
            onClick={() => setters[entry.key](!on)}
            disabled={props.disabled}
            title={entry.title}
            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-40 ${
              on
                ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            {on ? entry.label : entry.offLabel}
          </button>
        )
      })}

      <span className="ml-auto text-[11px] text-slate-400">
        Amber means changed from the shipping default.
      </span>
    </div>
  )
}
