import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'

/**
 * Shared by the editor and the request handler. Both sides must agree on the
 * serialization, since the model matches `old_str` against exactly this output.
 */
export const documentExtensions = [StarterKit, TableKit, Markdown]

const manager = new MarkdownManager({ extensions: [StarterKit, TableKit] })

/** The canonical Markdown for a document, and the only form the model is shown. */
export function serialize(doc: unknown): string {
  return manager.serialize(doc as never).trimEnd()
}

export function parse(markdown: string) {
  return manager.parse(markdown)
}

export { manager }
