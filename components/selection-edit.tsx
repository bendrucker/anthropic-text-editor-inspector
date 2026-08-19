import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { streamHighlightKey } from '@/lib/stream-highlight'

interface SelectionEditProps {
  editor: Editor
  onAsk: (selection: string, prompt: string) => void
}

/**
 * Selection-anchored entry point. Asking about a specific passage hands the model
 * the exact text, which is the shortest path to a unique `old_str`.
 */
export function SelectionEdit({ editor, onAsk }: SelectionEditProps) {
  const [active, setActive] = useState(false)
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const down = () => (dragging.current = true)
    const up = () => (dragging.current = false)
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  // Taking focus mid-drag pulls the caret out of the document and collapses the
  // selection being made, so focus waits for the pointer to come up.
  useEffect(() => {
    if (!active) return
    const focus = () => inputRef.current?.focus()
    if (!dragging.current) {
      focus()
      return
    }
    window.addEventListener('pointerup', focus, { once: true })
    return () => window.removeEventListener('pointerup', focus)
  }, [active])

  // The editor blurs when the input takes focus, which drops the native
  // selection. This keeps the target visible underneath.
  useEffect(() => {
    const { from, to } = editor.state.selection
    editor.view.dispatch(
      editor.state.tr.setMeta(
        streamHighlightKey,
        active ? { from, to, variant: 'target' } : null,
      ),
    )
  }, [active, editor])

  const dismiss = () => {
    setPrompt('')
    editor.commands.setTextSelection(editor.state.selection.to)
  }

  const submit = () => {
    const { from, to } = editor.state.selection
    if (!prompt.trim() || from === to) return
    const text = editor.state.doc.textBetween(from, to, '\n')
    dismiss()
    onAsk(text, prompt)
  }

  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: 'top-start',
        onShow: () => setActive(true),
        onHide: () => setActive(false),
      }}
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg shadow-slate-900/10 backdrop-blur"
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
    </BubbleMenu>
  )
}
