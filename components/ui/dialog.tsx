import * as Primitive from '@radix-ui/react-dialog'

export const Dialog = Primitive.Root
export const DialogTrigger = Primitive.Trigger

/**
 * `z-50` clears the tooltip layer. Popovers and selects sit at `z-30` and are
 * dismissed by the click that opens a dialog, so they never compete. The
 * tooltip on the trigger sits at `z-40` and Radix leaves it mounted through
 * that click, so anything lower gets a tooltip painted over the overlay.
 *
 * The title is the accessible name Radix requires and nothing this dialog needs
 * to say twice: it holds one sentence and one link, and a heading over two rows
 * makes it look like a settings panel.
 */
export function DialogContent({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-slate-900/20" />
      <Primitive.Content
        aria-describedby={undefined}
        className="fixed left-1/2 top-1/2 z-50 w-64 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-5 shadow-lg focus:outline-none"
      >
        <Primitive.Title className="sr-only">{title}</Primitive.Title>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}
