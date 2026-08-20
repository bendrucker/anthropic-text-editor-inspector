import type { ReactNode } from 'react'
import { SYNTHETIC_PATH, type EditorTool } from '@/lib/agent'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Tooltip } from './ui/tooltip'

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
  explanation: ReactNode
  /** True for a switch that exists only because this app writes the schema. */
  schemaBound?: boolean
}

const SWITCHES: Switch[] = [
  {
    key: 'guardrails',
    label: 'Prompt rules',
    offLabel: 'Prompt rules off',
    explanation: (
      <>
        On, the system prompt pre-teaches the two constraints a first attempt usually trips over:
        that <code>old_str</code> must match exactly once, and that table cells carry alignment
        padding that has to be reproduced. The model rarely fails, which also means the retry loop
        never runs where you can watch it. Off, the same constraints reach the model only as tool
        results after a rejected edit, so the console shows it learning them mid-run.
      </>
    ),
  },
  {
    key: 'oldStrFirst',
    label: 'old_str first',
    offLabel: 'new_str first',
    schemaBound: true,
    explanation: (
      <>
        Models emit tool input in the order the schema declares the properties. Declaring{' '}
        <code>old_str</code> first means the target text is known and can be highlighted while the
        replacement is still streaming in. Flip the order and the document sits inert until the last
        fragment arrives, because there is nothing to point at until then. That models follow schema
        order is observed behavior, not a guarantee the API makes.
      </>
    ),
  },
  {
    key: 'eagerStreaming',
    label: 'Eager streaming',
    offLabel: 'Eager streaming off',
    schemaBound: true,
    explanation: (
      <>
        On, <code>eager_input_streaming</code> sends unvalidated <code>input_json_delta</code>{' '}
        fragments as the model types them, which is what lets the buffer be scanned for a field that
        has not closed yet. Off, tool input lands in validated bursts, so there is no partial{' '}
        <code>old_str</code> to read and nothing can render before the edit is complete.
      </>
    ),
  },
]

const NOT_APPLICABLE = (
  <>
    The built-in tool has no property list to reorder and no <code>eager_input_streaming</code>{' '}
    field. That field is documented as available on user-defined tools only. Switch back to the
    custom <code>str_replace</code> to use this.
  </>
)

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
        <SelectTrigger aria-label="Editor tool" className="py-0.5">
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
          <Tooltip
            key={entry.key}
            content={inert ? NOT_APPLICABLE : entry.explanation}
            disabled={props.disabled || inert}
          >
            <button
              onClick={() => setters[entry.key](!on)}
              aria-pressed={inert ? undefined : on}
              disabled={props.disabled || inert}
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
          </Tooltip>
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
