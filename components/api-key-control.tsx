import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { keyStore, looksLikeAnthropicKey } from '@/lib/api-key'
import { Tooltip } from './ui/tooltip'

interface ApiKeyControlProps {
  apiKey: string | null
  onApiKey: (key: string | null) => void
}

export function ApiKeyControl(props: ApiKeyControlProps) {
  return keyStore.editable ? <KeyPopover {...props} /> : <EnvironmentKeyBadge />
}

/**
 * Nothing to enter or clear here, so the badge says where the key came from and
 * where the user has to go to change it, since this is not that place.
 */
function EnvironmentKeyBadge() {
  return (
    <Tooltip content={`${keyStore.description} ${keyStore.change}`}>
      <span
        tabIndex={0}
        className="focus-ring whitespace-nowrap rounded-md border border-control px-2.5 py-1 text-xs font-medium text-slate-500"
      >
        Key from dev server
      </span>
    </Tooltip>
  )
}

function KeyPopover({ apiKey, onApiKey }: ApiKeyControlProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const save = () => {
    const key = draft.trim()
    if (!key) return
    onApiKey(key)
    setDraft('')
    setOpen(false)
  }

  const malformed = draft.trim().length > 0 && !looksLikeAnthropicKey(draft)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition ${
          apiKey
            ? 'border-control text-slate-500 hover:bg-slate-50'
            : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
        }`}
      >
        {apiKey ? `Key ${mask(apiKey)}` : 'Add API key'}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-30 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          {apiKey ? (
            <div className="space-y-3">
              <p className="font-mono text-xs text-slate-500">{mask(apiKey)}</p>
              <p className="text-xs leading-relaxed text-slate-500">{keyStore.description}</p>
              <button
                onClick={() => {
                  onApiKey(null)
                  setOpen(false)
                }}
                className="w-full rounded-md border border-control px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Remove key
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                autoFocus
                type="password"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && save()}
                placeholder="sk-ant-…"
                className="w-full rounded-md border border-control px-2.5 py-1.5 font-mono text-xs text-slate-800 placeholder:text-slate-500 focus:border-control-strong focus-ring"
              />
              <p className={`text-xs leading-relaxed ${malformed ? 'text-amber-700' : 'text-slate-500'}`}>
                {malformed
                  ? 'That does not look like an Anthropic key, but you can save it anyway.'
                  : keyStore.description}
              </p>
              <button
                onClick={save}
                disabled={!draft.trim()}
                className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-30"
              >
                Save
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function mask(key: string) {
  return key.length <= 12 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`
}
