/**
 * The two ways this app says "something is happening right now".
 *
 * Both are needed because the waits are different. A dot says a request is out
 * and nothing has come back. A caret sits at the end of text that is still
 * growing, which is the only honest signal during the `block` and `document`
 * apply paths: those never touch the document until commit, so without a caret
 * on the buffer there is no motion anywhere on screen.
 */

/** A request is in flight and nothing has arrived to show yet. */
export function PulseDot({ className = 'bg-blue-500' }: { className?: string }) {
  return (
    <span className="relative flex size-1.5 shrink-0">
      <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${className}`} />
      <span className={`relative inline-flex size-1.5 rounded-full ${className}`} />
    </span>
  )
}

/** Text is still arriving here. */
export function StreamCaret() {
  return (
    <span className="ml-px inline-block h-3 w-1 translate-y-px animate-pulse bg-blue-500 align-baseline" />
  )
}
