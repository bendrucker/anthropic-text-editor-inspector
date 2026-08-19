import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { streamHighlightKey } from '@/lib/stream-highlight'

interface SelectionBubbleProps {
  editor: Editor
  onAsk: (selection: string, prompt: string) => void
}

interface Target {
  from: number
  to: number
  text: string
}

const GAP = 10
const MARGIN = 8

/**
 * Selection-anchored entry point. Asking about a specific passage hands the model
 * the exact text, which is the shortest path to a unique `old_str`.
 */
export function SelectionBubble({ editor, onAsk }: SelectionBubbleProps) {
  const [target, setTarget] = useState<Target | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const readTarget = useCallback((): Target | null => {
    const { from, to, empty } = editor.state.selection
    if (empty) return null
    const text = editor.state.doc.textBetween(from, to, '\n')
    return text.trim() ? { from, to, text } : null
  }, [editor])

  // Reading the selection on every update would steal focus mid-drag and collapse
  // it, so a drag only produces a bubble once the pointer is released.
  useEffect(() => {
    const dom = editor.view.dom

    const sync = () => {
      if (!dragging.current) setTarget(readTarget())
    }
    const start = () => {
      dragging.current = true
      setTarget(null)
    }
    const end = () => {
      if (!dragging.current) return
      dragging.current = false
      setTarget(readTarget())
    }

    editor.on('selectionUpdate', sync)
    dom.addEventListener('pointerdown', start)
    // A drag that runs past the editor releases outside it.
    window.addEventListener('pointerup', end)

    return () => {
      editor.off('selectionUpdate', sync)
      dom.removeEventListener('pointerdown', start)
      window.removeEventListener('pointerup', end)
    }
  }, [editor, readTarget])

  // Keeps the selection visible after the input takes focus and the editor blurs.
  useEffect(() => {
    editor.view.dispatch(
      editor.state.tr.setMeta(
        streamHighlightKey,
        target ? { from: target.from, to: target.to, variant: 'target' } : null,
      ),
    )
  }, [target, editor])

  useLayoutEffect(() => {
    if (!target) {
      setPosition(null)
      return
    }

    const place = () => {
      const bubble = bubbleRef.current
      const pane = editor.view.dom.closest('[data-document-pane]')?.getBoundingClientRect()
      if (!bubble || !pane) return

      const head = editor.view.coordsAtPos(target.from)
      const tail = editor.view.coordsAtPos(target.to)

      // An anchor scrolled out of the pane leaves nothing to point at.
      if (tail.bottom < pane.top || head.top > pane.bottom) {
        setPosition(null)
        return
      }

      const above = head.top - bubble.offsetHeight - GAP
      const top = Math.min(
        Math.max(above < pane.top + MARGIN ? tail.bottom + GAP : above, pane.top + MARGIN),
        pane.bottom - bubble.offsetHeight - MARGIN,
      )
      const left = Math.min(
        Math.max(head.left, pane.left + MARGIN),
        pane.right - bubble.offsetWidth - MARGIN,
      )

      setPosition({ top, left })
    }

    place()

    const scroller = editor.view.dom.closest('[data-document-scroll]')
    scroller?.addEventListener('scroll', place)
    window.addEventListener('resize', place)

    return () => {
      scroller?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  }, [target, editor])

  const active = target !== null
  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  if (!target) return null

  const dismiss = () => {
    setTarget(null)
    setPrompt('')
  }

  const submit = () => {
    if (!prompt.trim()) return
    editor.view.dispatch(editor.state.tr.setMeta(streamHighlightKey, null))
    onAsk(target.text, prompt)
    dismiss()
  }

  return (
    <div
      ref={bubbleRef}
      className="fixed z-20 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg shadow-slate-900/10 backdrop-blur"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <input
        ref={inputRef}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          if (event.key === 'Escape') dismiss()
        }}
        placeholder="Change this to…"
        className="w-72 bg-transparent px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={!prompt.trim()}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-30"
      >
        Edit
      </button>
    </div>
  )
}
