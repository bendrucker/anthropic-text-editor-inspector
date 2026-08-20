import * as Primitive from '@radix-ui/react-tooltip'

/**
 * Short enough that stopping on a control reads as an answer rather than a wait.
 * These controls sit close together, so the default skip window carries a reader
 * who is already comparing two of them straight to the second explanation.
 */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <Primitive.Provider delayDuration={200}>{children}</Primitive.Provider>
}

/**
 * Sized for a paragraph, because the distinctions these controls encode are the
 * kind no label can carry: what a switch does when it is off, why a button is
 * unavailable, which segment of a wait a setting moves.
 *
 * `content` is optional so a caller whose explanation only applies in one state
 * can pass it conditionally rather than branch around the whole subtree.
 */
export function Tooltip({
  content,
  side = 'bottom',
  align = 'center',
  disabled = false,
  children,
}: {
  content?: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /**
   * The wrapped control is disabled. A disabled button reports no hover and
   * takes no focus, so the tooltip explaining why it cannot be used would be
   * the one nobody could reach. The trigger moves to a focusable stand-in
   * around the control, which keyboard and screen-reader users land on in place
   * of the button it wraps.
   */
  disabled?: boolean
  children: React.ReactElement
}) {
  if (content === undefined) return children

  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>
        {disabled ? (
          <span role="button" aria-disabled tabIndex={0} className="inline-flex">
            {children}
          </span>
        ) : (
          children
        )}
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-40 max-w-80 rounded-lg bg-slate-800 px-2.5 py-2 text-[11px] leading-relaxed text-slate-100 shadow-lg [&_code]:rounded [&_code]:bg-white/15 [&_code]:px-1 [&_code]:font-mono [&_code]:text-slate-50"
        >
          {content}
          <Primitive.Arrow className="fill-slate-800" />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}

export interface ToggleState {
  /** What this control calls the state. `old_str first` reads better than On. */
  name: React.ReactNode
  body: React.ReactNode
}

/**
 * Both states of a toggle, with the live one named in a word.
 *
 * A two-state button's label reads the same whether it reports what is set now
 * or what clicking would set, and the colour that separates the two is a
 * convention a first-time reader has not learned. Naming the current state
 * settles it without spending label width. The word is what carries: this is
 * the `aria-describedby` target, where a dot or a colour reaches nobody.
 */
export function TooltipStates({
  states,
  current,
}: {
  states: Record<'on' | 'off', ToggleState>
  current: 'on' | 'off'
}) {
  return (
    <div className="space-y-2">
      {(['on', 'off'] as const).map((which) => {
        const live = which === current
        return (
          <div
            key={which}
            className={`border-l-2 pl-2 ${live ? 'border-slate-300' : 'border-slate-500'}`}
          >
            <p className={`font-semibold ${live ? 'text-slate-50' : 'text-slate-300'}`}>
              {states[which].name}
              {/* The separator is a space in the text, so a screen reader does
                  not run the state name straight into the word marking it. */}
              {live && <span className="font-normal text-slate-400"> · current</span>}
            </p>
            <p className="mt-0.5 text-slate-200">{states[which].body}</p>
          </div>
        )
      })}
    </div>
  )
}
