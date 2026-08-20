import * as Primitive from '@radix-ui/react-popover'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger

export function PopoverContent({
  align = 'end',
  className,
  children,
}: {
  align?: 'start' | 'center' | 'end'
  className?: string
  children: React.ReactNode
}) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={4}
        className={`z-30 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg ${className ?? ''}`}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}

export function PopoverCheck({
  checked,
  onChange,
  children,
  count,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  children: React.ReactNode
  count?: number
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3 shrink-0 accent-slate-500"
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="shrink-0 tabular-nums text-slate-400">{count}</span>}
    </label>
  )
}
