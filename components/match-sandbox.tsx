import { useMemo, useState } from 'react'
import { Tooltip } from './ui/tooltip'
import { locateEdit } from '@/lib/str-replace'
import type { Match } from '@/lib/str-replace'
import type { Probe } from '@/lib/traps'

interface MatchSandboxProps {
  /** The document as the matcher sees it: canonical serializer output. */
  canonical: () => string
  /** Presets derived from the open document, each reaching a different rejection. */
  probes: Probe[]
  onShowMatches: (matches: Match[]) => void
}

/**
 * The matcher without the model. Every rejection the tool can produce is
 * reachable here deterministically, for free, with no API key.
 */
export function MatchSandbox({ canonical, probes, onShowMatches }: MatchSandboxProps) {
  const [oldStr, setOldStr] = useState('')
  const [replaceAll, setReplaceAll] = useState(false)
  const [probed, setProbed] = useState(0)

  // Probes are rederived per document, so a new array means a different document
  // is open and any pending old_str quotes text nobody can see any more.
  const [priorProbes, setPriorProbes] = useState(probes)
  if (probes !== priorProbes) {
    setPriorProbes(probes)
    setOldStr('')
  }

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
        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">
          Runs the same <span className="font-mono">locateEdit</span> the tool runs, against the live
          document. No model, no key.
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {probes.map((probe) => (
          <Tooltip key={probe.label} content={probe.note} side="top">
            <button
              onClick={() => {
                setOldStr(probe.oldStr)
                setProbed((prior) => prior + 1)
              }}
              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 transition hover:border-slate-300"
            >
              {probe.label}
            </button>
          </Tooltip>
        ))}
      </div>

      <textarea
        value={oldStr}
        onChange={(event) => setOldStr(event.target.value)}
        rows={3}
        placeholder="old_str"
        className="resize-none rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] leading-relaxed text-slate-700 placeholder:text-slate-500 focus:border-slate-400 focus:outline-none"
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
