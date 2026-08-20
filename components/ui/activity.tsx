/**
 * The two ways this app says "something is happening right now".
 *
 * A dot says a request is out and nothing has come back. A caret sits at the end
 * of text that is still growing, which on the `block` and `document` apply paths
 * is the only motion on screen: those do not touch the document until commit.
 */

export function PulseDot() {
  return (
    <span className="relative flex size-1.5 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-60" />
      <span className="relative inline-flex size-1.5 rounded-full bg-blue-500" />
    </span>
  )
}

export function StreamCaret() {
  return (
    <span className="ml-px inline-block h-3 w-1 translate-y-px animate-pulse bg-blue-500 align-baseline" />
  )
}
