import { SAMPLES, type LibraryDocument } from '@/lib/library'
import { Tooltip } from './ui/tooltip'

interface DocumentPickerProps {
  document: LibraryDocument
  generated: LibraryDocument[]
  onSelect: (id: string) => void
  onGenerate: () => void
  disabled: boolean
}

/**
 * Switching documents throws away the timeline, the buffer, and the replay,
 * since all three describe the document that was open when they were recorded.
 */
export function DocumentPicker({
  document,
  generated,
  onSelect,
  onGenerate,
  disabled,
}: DocumentPickerProps) {
  return (
    <div className="flex items-center gap-2">
      <Tooltip
        disabled={disabled}
        content={
          <>
            {document.description} Choosing another document clears the timeline, the buffer, and
            the replay, since all three describe the document that was open when they were recorded.
          </>
        }
      >
        <select
          value={document.id}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value)}
          aria-label="Document"
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 focus-ring disabled:opacity-50"
        >
          <optgroup label="Samples">
            {/* A native option list is drawn by the OS, so this one description
                stays a browser tooltip. */}
            {SAMPLES.map((option) => (
              <option key={option.id} value={option.id} title={option.description}>
                {option.title}
              </option>
            ))}
          </optgroup>

          {generated.length > 0 && (
            <optgroup label="Generated">
              {generated.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Tooltip>

      <Tooltip
        disabled={disabled}
        content={
          <>
            Builds a fresh document from a random seed, planting strings that repeat so the
            targets offered alongside it are genuinely ambiguous rather than hand-written against
            one sample.
          </>
        }
      >
        <button
          onClick={onGenerate}
          disabled={disabled}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:opacity-40"
        >
          Generate
        </button>
      </Tooltip>
    </div>
  )
}
