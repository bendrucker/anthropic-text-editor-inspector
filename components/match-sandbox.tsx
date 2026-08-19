import { useMemo, useState } from 'react'
import { locateEdit } from '@/lib/str-replace'
import type { Match } from '@/lib/str-replace'

interface MatchSandboxProps {
  /** The document as the matcher sees it: canonical serializer output. */
  canonical: () => string
  onShowMatches: (matches: Match[]) => void
}

const PROBES = [
  { label: 'Ambiguous', oldStr: 'Commit', note: 'Appears four times. Rejected as ambiguous.' },
  {
    label: 'Unpadded row',
    oldStr: '| Enterprise | 47 | $58.2M | $19.4M | 22% |',
    note: 'The real row, with the column padding collapsed. Rejected for whitespace.',
  },
  {
    label: 'Absent',
    oldStr: 'Pipeline coverage finished the year',
    note: 'Plausible sentence that is not in the document.',
  },
]

/**
 * The matcher without the model. Every rejection the tool can produce is
 * reachable here deterministically, for free, with no API key.
 */
export function MatchSandbox({ canonical, onShowMatches }: MatchSandboxProps) {
  const [oldStr, setOldStr] = useState('')
  const [replaceAll, setReplaceAll] = useState(false)
  const [probed, setProbed] = useState(0)

  const outcome = useMemo(() => {
    if (!oldStr) return null
    const result = locateEdit(canonical(), oldStr, replaceAll)
    return result
    // `probed` re-runs the match after the document changes underneath it.
  }, [oldStr, replaceAll, canonical, probed])

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-4 py-3">
      <div>
        <p className="text-[11px] font-medium text-slate-500">Try the matcher</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
          Runs the same <span className="font-mono">locateEdit</span> the tool runs, against the live
          document. No model, no key.
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {PROBES.map((probe) => (
          <button
            key={probe.label}
            onClick={() => {
              setOldStr(probe.oldStr)
              setProbed((prior) => prior + 1)
            }}
            title={probe.note}
            className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 transition hover:border-slate-300"
          >
            {probe.label}
          </button>
        ))}
      </div>

      <textarea
        value={oldStr}
        onChange={(event) => setOldStr(event.target.value)}
        rows={3}
        placeholder="old_str"
        className="resize-none rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] leading-relaxed text-slate-700 placeholder:text-slate-300 focus:border-slate-400 focus:outline-none"
      />

      <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
        <input
          type="checkbox"
          checked={replaceAll}
          onChange={(event) => setReplaceAll(event.target.checked)}
        />
        <span className="font-mono">replace_all</span>
      </label>

      {outcome && (
        <div
          className={`rounded border px-2 py-1.5 text-[10px] leading-relaxed ${
            outcome.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {outcome.ok ? (
            <p>
              Matched {outcome.matches.length}{' '}
              {outcome.matches.length === 1 ? 'location' : 'locations'}. The edit would apply.
            </p>
          ) : (
            <>
              <p className="mb-1 font-medium">Rejected. This text goes back as the tool result:</p>
              <p className="font-mono">{outcome.message}</p>
            </>
          )}

          {outcome.matches.length > 0 && (
            <button
              onClick={() => onShowMatches(outcome.matches)}
              className="mt-1.5 underline underline-offset-2 hover:no-underline"
            >
              Show {outcome.matches.length === 1 ? 'it' : `all ${outcome.matches.length}`} in the document
            </button>
          )}
        </div>
      )}
    </div>
  )
}
