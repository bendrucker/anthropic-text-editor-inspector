import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import { StreamHighlight } from '@/lib/stream-highlight'
import { SelectionEdit } from './selection-edit'

interface DocumentPaneProps {
  initialMarkdown: string
  locked: boolean
  onEditor: (editor: Editor | null) => void
  onAskAboutSelection: (selection: string, prompt: string) => void
}

export function DocumentPane({ initialMarkdown, locked, onEditor, onAskAboutSelection }: DocumentPaneProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, TableKit, Markdown, StreamHighlight],
    content: initialMarkdown,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none prose-headings:font-semibold',
      },
    },
  })

  useEffect(() => {
    onEditor(editor)
    return () => onEditor(null)
  }, [editor, onEditor])

  return (
    <div data-document-pane className="relative flex h-full min-h-0 flex-col">
      <div data-document-scroll className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-12 py-14">
          <EditorContent editor={editor} />
        </div>

        {locked && (
          <div
            className="pointer-events-none absolute inset-0 bg-slate-900/[0.015]"
            aria-hidden
          />
        )}
      </div>

      {editor && !locked && <SelectionEdit editor={editor} onAsk={onAskAboutSelection} />}
    </div>
  )
}
