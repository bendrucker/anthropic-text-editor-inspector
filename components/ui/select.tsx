import * as Primitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

export const Select = Primitive.Root
export const SelectValue = Primitive.Value

/**
 * A trigger's label is the name of the current choice, and a name broken across
 * two lines reads as two choices. Every trigger in this app sits in a
 * horizontal control row, so the row is what should break first. `className` is
 * appended after this, so a caller that wants wrapping can still ask for it.
 */
export function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={`flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`}
      {...props}
    >
      {children}
      <Primitive.Icon asChild>
        <ChevronDown className="size-3 text-slate-500" />
      </Primitive.Icon>
    </Primitive.Trigger>
  )
}

export function SelectContent({ children }: { children: React.ReactNode }) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        position="popper"
        sideOffset={4}
        className="z-30 max-h-80 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
      >
        <Primitive.Viewport>{children}</Primitive.Viewport>
      </Primitive.Content>
    </Primitive.Portal>
  )
}

/** The note is the reason for a custom select: a native `<option>` cannot carry it. */
export function SelectItem({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <Primitive.Item
      value={value}
      className="focus-ring-inset relative rounded px-2 py-1.5 pr-7 data-[highlighted]:bg-slate-100"
    >
      <Primitive.ItemText>
        <span className="text-xs font-medium text-slate-700">{label}</span>
      </Primitive.ItemText>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{note}</p>
      <Primitive.ItemIndicator className="absolute right-2 top-2">
        <Check className="size-3 text-slate-500" />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  )
}
