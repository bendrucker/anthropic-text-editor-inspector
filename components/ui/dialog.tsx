import * as Primitive from '@radix-ui/react-dialog'

export const Dialog = Primitive.Root
export const DialogTrigger = Primitive.Trigger

/**
 * `z-50` is the top of the app's layer scale, above the console chrome at
 * `z-10` and `z-20`, popovers and selects at `z-30`, and tooltips at `z-40`.
 * The console chrome is the live constraint, because it is in the page and
 * stays mounted under an open dialog. The portalled layers all dismiss on the
 * click that opens one, so they never get to compete.
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
        className="fixed left-1/2 top-1/2 z-50 w-64 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-5 shadow-lg focus:outline-none"
      >
        <Primitive.Title className="sr-only">{title}</Primitive.Title>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}
