import { StreamCaret } from './activity'

/**
 * Renders a tool string the way the matcher sees it. Runs of spaces, tabs, and
 * line breaks are marked, since collapsing them would hide the exact thing
 * `old_str` matching turns on.
 */
export function ExactText({
  text,
  className = '',
  caret = false,
}: {
  text: string
  className?: string
  /** Mark the write head, for a string the model has not closed yet. */
  caret?: boolean
}) {
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
      {caret && <StreamCaret />}
    </pre>
  )
}
