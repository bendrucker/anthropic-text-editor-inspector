import { SYNTHETIC_PATH, type EditorTool } from '@/lib/agent'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Tooltip, TooltipStates, type ToggleState } from './ui/tooltip'

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
  /**
   * Both halves, so the tooltip can name the live one. Each pair answers the
   * same questions in the same order, which is what makes them comparable at a
   * glance.
   */
  states: Record<'on' | 'off', ToggleState>
  /**
   * Why the built-in tool cannot express this switch, for the switches that
   * exist only because this app writes the schema. What is missing differs per
   * switch, so one shared explanation answers half of each.
   */
  unavailable?: React.ReactNode
}

const SWITCHES: Switch[] = [
  {
    key: 'guardrails',
    label: 'Prompt rules',
    offLabel: 'Prompt rules off',
    states: {
      on: {
        name: 'stated',
        body: (
          <>
            The system prompt states both constraints up front: <code>old_str</code> must match
            exactly once, and table cells carry alignment padding that has to be reproduced. It also
            names the two ways out of a repeat, extending <code>old_str</code> and setting{' '}
            <code>replace_all</code>.
          </>
        ),
      },
      off: {
        name: 'unstated',
        body: (
          <>
            Nothing states the constraints, so the model is working from its own training. Across
            144 runs on the Ambiguous targets prompts, 72 with the rules stated and 72 without, it
            satisfied both constraints either way. The switch shows how little the prompt is
            carrying, not a retry loop it turns on.
          </>
        ),
      },
    },
  },
  {
    key: 'oldStrFirst',
    label: 'old_str first',
    offLabel: 'new_str first',
    unavailable: (
      <>
        <code>text_editor_20250728</code> declares its own parameters and this app never writes
        them, so there is no property list to put <code>old_str</code> in front of. Switch to the
        custom <code>str_replace</code> to control the order.
      </>
    ),
    states: {
      on: {
        name: <code>old_str</code>,
        body: (
          <>
            The schema declares <code>old_str</code> before <code>new_str</code>, and models emit
            tool input in declaration order. The target is known while the replacement is still
            streaming, so the match highlights before the edit completes. That ordering is observed
            behavior rather than a guarantee the API makes.
          </>
        ),
      },
      off: {
        name: <code>new_str</code>,
        body: (
          <>
            The replacement arrives before anything says where it goes. Nothing can be highlighted
            until the last fragment lands, so the document sits inert for the whole stream.
          </>
        ),
      },
    },
  },
  {
    key: 'eagerStreaming',
    label: 'Eager streaming',
    offLabel: 'Eager streaming off',
    unavailable: (
      <>
        <code>eager_input_streaming</code> is a field on user-defined tools, and{' '}
        <code>text_editor_20250728</code> has no slot for it. Nothing in the request can ask for
        unvalidated fragments, so there is no setting here to turn on. Switch to the custom{' '}
        <code>str_replace</code> to send it.
      </>
    ),
    states: {
      on: {
        name: 'eager',
        body: (
          <>
            <code>eager_input_streaming</code> sends <code>input_json_delta</code> fragments
            unvalidated, as the model types them, so the buffer can be scanned for a field that has
            not closed yet. The replacement paints across many frames. The edit finishes no sooner.
            What changes is that you can watch it arrive.
          </>
        ),
      },
      off: {
        name: 'validated',
        body: (
          <>
            Tool input arrives in validated bursts, so there is no partial <code>old_str</code> to
            read. The replacement's first paint and its settled state land in the same frame.
          </>
        ),
      },
    },
  },
]

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
    // One row holds the controls and the note only while both fit. Below `lg`
    // the note takes a row of its own, because sharing with controls that
    // cannot wrap left it a word wide and six lines tall.
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-slate-200 bg-slate-50/70 px-6 py-1.5 lg:flex-row lg:items-center lg:gap-2">
      {/* `shrink-0` settles which side gives way: prose rewraps, a control
          label does not. Within the group `flex-wrap` lets the switches move to
          a second line rather than each one shredding its own label. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="mr-1 text-[11px] font-medium tracking-wide whitespace-nowrap text-slate-600 uppercase">
          Tool setup
        </span>

        <Select
          value={props.editorTool}
          onValueChange={(next) => props.onEditorTool(next as EditorTool)}
          disabled={props.disabled}
        >
          {/* The tooltip wraps the trigger rather than the select, because
              `Select` is context and renders no element for `asChild` to attach
              hover and focus to.

              Both options get described. The trigger already reads back the
              current tool, so what a reader is missing is the other one: which
              of the switches beside it survive the swap, and why. The
              per-option notes answer that only while the list is open, which is
              after the choice has been made. */}
          <Tooltip
            disabled={props.disabled}
            content={
              <div className="space-y-2">
                <p>
                  <span className="font-semibold text-slate-50">Custom str_replace</span> lets this
                  app write the schema. It can declare <code>old_str</code> before{' '}
                  <code>new_str</code> and set <code>eager_input_streaming</code>, which is what
                  the two switches beside it control.
                </p>
                <p>
                  <span className="font-semibold text-slate-50">Built-in text editor</span> hands
                  the schema to Anthropic. <code>text_editor_20250728</code> has no{' '}
                  <code>eager_input_streaming</code> field and no property list to reorder, so both
                  of those switches go inert. The call still comes back for this app to run.
                </p>
              </div>
            }
          >
            <SelectTrigger aria-label="Editor tool" className="py-0.5">
              <SelectValue />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {EDITOR_TOOLS.map((option) => (
              <SelectItem
                key={option.id}
                value={option.id}
                label={option.label}
                note={option.note}
              />
            ))}
          </SelectContent>
        </Select>

        {SWITCHES.map((entry) => {
          const on = props[entry.key]
          const inert = builtin && entry.unavailable !== undefined

          return (
            <Tooltip
              key={entry.key}
              content={
                inert ? (
                  entry.unavailable
                ) : (
                  <TooltipStates states={entry.states} current={on ? 'on' : 'off'} />
                )
              }
              disabled={props.disabled || inert}
            >
              <button
                onClick={() => setters[entry.key](!on)}
                aria-pressed={inert ? undefined : on}
                disabled={props.disabled || inert}
                className={`rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition disabled:cursor-not-allowed ${
                  inert
                    ? // Keeps the faint edge the live switch just gave up. 1.4.11
                      // excepts an inactive component, and a switch the built-in
                      // tool has taken away is meant to recede: dashed, struck
                      // through, and too pale to invite a click.
                      'border-dashed border-slate-200 bg-transparent text-slate-300 line-through'
                    : // Both live states carry the same edge, because both are
                      // settings a reader chose and neither is a problem. The
                      // fill is the only difference and it stays inside the
                      // greys: `slate-100` is the darkest ground #63 measured
                      // `control` against, at 3.18:1. What separates the two
                      // states is the label, which says `new_str first` or
                      // `Prompt rules off` in words a screen reader also gets.
                      `border-control hover:border-control-strong disabled:opacity-40 ${
                        on ? 'bg-white text-slate-600' : 'bg-slate-100 text-slate-700'
                      }`
                }`}
              >
                {inert ? entry.label : on ? entry.label : entry.offLabel}
              </button>
            </Tooltip>
          )
        })}
      </div>

      {/* Kept rather than hidden the way the header's document description is.
          A row of its own costs one line and reads at any width.

          It no longer branches on the tool. The built-in half glossed
          `Server-defined`, a term this row never prints, and the rest of what it
          said is on the select's own tooltip a few pixels to the left. That is
          the same test #58 used to let the header's description go. It also
          meant that picking the built-in tool took the switch legend off screen
          while Prompt rules was still live and still settable.

          What survives is the half a label cannot carry. Each button names the
          state it is in, so the one thing left to say is which state it started
          in and what moving it costs. */}
      <span className="text-[11px] text-slate-600 lg:ml-auto">
        Every switch ships on. Flip one and this app sends a different request.
      </span>
    </div>
  )
}
