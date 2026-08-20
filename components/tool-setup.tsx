import { SYNTHETIC_PATH, type EditorTool } from '@/lib/agent'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface ToolSetupProps {
  editorTool: EditorTool
  onEditorTool: (tool: EditorTool) => void
  guardrails: boolean
  onGuardrails: (on: boolean) => void
  oldStrFirst: boolean
  onOldStrFirst: (on: boolean) => void
  eagerStreaming: boolean
  onEagerStreaming: (on: boolean) => void
  disabled: boolean
}

const EDITOR_TOOLS: { id: EditorTool; label: string; note: string }[] = [
  {
    id: 'custom',
    label: 'Custom str_replace',
    note: 'This app writes the schema, so it can order the keys and ask for eager streaming.',
  },
  {
    id: 'builtin',
    label: 'Built-in text editor',
    note: `text_editor_20250728, whose schema Anthropic writes. Neither control below reaches it. The call still comes back for this app to run, against the document at ${SYNTHETIC_PATH}.`,
  },
]

interface Switch {
  key: 'guardrails' | 'oldStrFirst' | 'eagerStreaming'
  label: string
  /** What the run does when the switch is off, which is the interesting half. */
  offLabel: string
  title: string
  /** True for a switch that exists only because this app writes the schema. */
  schemaBound?: boolean
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
    schemaBound: true,
    title:
      'Models emit tool input in schema order. Declaring old_str first means the target is known while the replacement streams. Flip it and the document sits inert until the very end. Order-follows-schema is observed behavior, not a spec guarantee.',
  },
  {
    key: 'eagerStreaming',
    label: 'Eager streaming',
    offLabel: 'Eager streaming off',
    schemaBound: true,
    title:
      'On, unvalidated input_json_delta fragments arrive as the model types them. Off, tool input lands in validated bursts and nothing can render early.',
  },
]

const NOT_APPLICABLE = 'Not available on the built-in tool'

/**
 * The tool's own configuration, kept on screen rather than buried in code,
 * because every switch here changes something the inspector will show. The
 * two that only the custom schema can express go grey rather than away, so the
 * cost of handing the schema to Anthropic stays visible.
 */
export function ToolSetup(props: ToolSetupProps) {
  const setters = {
    guardrails: props.onGuardrails,
    oldStrFirst: props.onOldStrFirst,
    eagerStreaming: props.onEagerStreaming,
  }
  const builtin = props.editorTool === 'builtin'

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-6 py-1.5">
      <span className="mr-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
        Tool setup
      </span>

      <Select
        value={props.editorTool}
        onValueChange={(next) => props.onEditorTool(next as EditorTool)}
        disabled={props.disabled}
      >
        <SelectTrigger className="py-0.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EDITOR_TOOLS.map((option) => (
            <SelectItem key={option.id} value={option.id} label={option.label} note={option.note} />
          ))}
        </SelectContent>
      </Select>

      {SWITCHES.map((entry) => {
        const on = props[entry.key]
        const inert = builtin && entry.schemaBound

        return (
          <button
            key={entry.key}
            onClick={() => setters[entry.key](!on)}
            aria-pressed={inert ? undefined : on}
            disabled={props.disabled || inert}
            title={inert ? NOT_APPLICABLE : entry.title}
            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition disabled:cursor-not-allowed ${
              inert
                ? 'border-dashed border-slate-200 bg-transparent text-slate-300 line-through'
                : on
                  ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 disabled:opacity-40'
                  : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-40'
            }`}
          >
            {inert ? entry.label : on ? entry.label : entry.offLabel}
          </button>
        )
      })}

      <span className="ml-auto text-[11px] text-slate-400">
        {builtin
          ? 'Server-defined means the schema. This app still runs the call and returns the result.'
          : 'Amber means changed from the shipping default.'}
      </span>
    </div>
  )
}
