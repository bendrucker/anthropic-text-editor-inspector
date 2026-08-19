import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const streamHighlightKey = new PluginKey<DecorationSet>('streamHighlight')

export interface HighlightRange {
  from: number
  to: number
  variant: 'target' | 'writing' | 'settled' | 'ambiguous'
}

/**
 * Marks the range an agent edit is landing in. The decoration is remapped
 * through every transaction, so it follows the text as characters stream in.
 */
export const StreamHighlight = Extension.create({
  name: 'streamHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: streamHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            const meta = tr.getMeta(streamHighlightKey) as
              | HighlightRange
              | HighlightRange[]
              | null
              | undefined

            if (meta === null) return DecorationSet.empty
            if (meta) {
              const ranges = Array.isArray(meta) ? meta : [meta]
              return DecorationSet.create(
                tr.doc,
                ranges.map((range) =>
                  Decoration.inline(range.from, range.to, {
                    class: `agent-edit agent-edit-${range.variant}`,
                  }),
                ),
              )
            }

            return previous.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return streamHighlightKey.getState(state)
          },
        },
      }),
    ]
  },
})
