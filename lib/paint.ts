/**
 * When a change reached the screen.
 *
 * No browser API reports the paint time of an arbitrary DOM mutation. The
 * `paint` performance entries fire once per navigation, and element timing
 * reports an element's first render rather than every later one. What is
 * knowable is the frame boundary: a frame's animation-frame callbacks run
 * before that frame paints, so once the next frame's callback runs the pixels
 * exist. Every timestamp here is that next callback's, which overshoots the
 * true paint by at most one frame and never claims a change was visible before
 * it was.
 */

/**
 * Calls back with the first timestamp at which the mutations made so far are
 * known to be on screen. The argument shares a clock with `performance.now()`.
 *
 * The timestamp an animation-frame callback is handed is its frame's nominal
 * start, which a long preceding frame can push earlier than that frame's own
 * end. Reading the clock instead cannot land before the paint it reports.
 */
export function afterPaint(callback: (atMs: number) => void): void {
  requestAnimationFrame(() => requestAnimationFrame(() => callback(performance.now())))
}

export interface PaintCount {
  /** Frames that carried a document change, rather than mutations. */
  frames: number
  firstAtMs: number | null
  lastAtMs: number | null
}

export interface PaintCounter {
  /** Marks a document mutation. Ten in one frame count as the one frame they cost. */
  touched: () => void
  read: () => PaintCount
}

/**
 * Counts the frames a run painted into.
 *
 * Hundreds of streamed fragments become the far smaller number of times the
 * document actually moved. The last of those frames is when the document
 * stopped changing, which is rarely when the run stopped.
 */
export function countPaintFrames(): PaintCounter {
  let frames = 0
  let firstAtMs: number | null = null
  let lastAtMs: number | null = null
  let dirty = false
  let painting = false
  let handle: number | null = null

  function frame() {
    // A mutation seen last frame has painted by now, so the clock reads the
    // first moment it is known to be visible.
    if (painting) {
      const now = performance.now()
      frames += 1
      firstAtMs ??= now
      lastAtMs = now
      painting = false
    }
    if (dirty) {
      painting = true
      dirty = false
    }
    // With nothing left to watch the loop stops, so an idle run costs no frames.
    handle = painting ? requestAnimationFrame(frame) : null
  }

  return {
    touched: () => {
      dirty = true
      handle ??= requestAnimationFrame(frame)
    },
    read: () => ({ frames, firstAtMs, lastAtMs }),
  }
}
