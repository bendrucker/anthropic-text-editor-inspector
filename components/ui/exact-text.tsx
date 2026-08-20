/**
 * Renders a tool string the way the matcher sees it. Collapsing whitespace here
 * would hide the exact thing `old_str` matching turns on, so runs of spaces and
 * line breaks are marked rather than normalized.
 */
export function ExactText({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null

  return (
    <pre
      className={`max-h-32 overflow-auto rounded border border-black/5 bg-white/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap ${className}`}
    >
      {text.split(/( {2,}|\n|\t)/).map((part, index) =>
        /^( {2,}|\n|\t)$/.test(part) ? (
          <span key={index} className="text-slate-400">
            {part.replace(/ /g, '·').replace(/\t/g, '→').replace(/\n/g, '¶\n')}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </pre>
  )
}
