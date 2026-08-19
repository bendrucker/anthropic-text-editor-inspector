import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { serialize } from './markdown'

/**
 * Bridges the two address spaces in play: the model edits a Markdown string,
 * the editor holds a tree.
 *
 * An edit landing inside a single block's plain text can be streamed character
 * by character. Anything touching markup or crossing block boundaries is
 * replaced wholesale, because streaming raw Markdown into a text range would
 * render syntax as literal characters and, in a table, destroy the structure.
 */

export type EditTarget =
  | { kind: 'inline'; from: number; to: number }
  | { kind: 'block'; from: number; to: number }
  | { kind: 'document' }

interface BlockSpan {
  /** Offsets into the canonical Markdown. */
  start: number
  end: number
  /** ProseMirror position of the block node. */
  pos: number
  node: ProseMirrorNode
}

/**
 * Locates each top-level block within the canonical Markdown by serializing it
 * alone and finding that text in the whole-document output. Table padding
 * depends only on the table's own cells, so a block serializes identically in
 * both settings.
 */
export function mapBlocks(doc: ProseMirrorNode, canonical: string): BlockSpan[] {
  const spans: BlockSpan[] = []
  let cursor = 0
  let pos = 0

  doc.forEach((node) => {
    const nodePos = pos
    pos += node.nodeSize

    const chunk = serialize({ type: 'doc', content: [node.toJSON()] })
    if (!chunk) return

    const start = canonical.indexOf(chunk, cursor)
    if (start === -1) return

    spans.push({ start, end: start + chunk.length, pos: nodePos, node })
    cursor = start + chunk.length
  })

  return spans
}

/**
 * Converts an offset into a block's `textContent` to a ProseMirror position.
 * Inline nodes that render no text (hard breaks) still occupy a position, so
 * the inline children are walked rather than assuming a linear mapping.
 */
function textOffsetToPosition(block: ProseMirrorNode, blockPos: number, offset: number): number {
  let seen = 0
  let position = blockPos + 1

  for (let i = 0; i < block.childCount; i++) {
    const child = block.child(i)
    if (child.isText) {
      const length = child.text?.length ?? 0
      if (seen + length >= offset) return position + (offset - seen)
      seen += length
      position += length
      continue
    }
    position += child.nodeSize
  }

  return position
}

export function resolveTarget(
  doc: ProseMirrorNode,
  canonical: string,
  match: { start: number; end: number },
): EditTarget {
  const spans = mapBlocks(doc, canonical)
  const containing = spans.filter((span) => match.start < span.end && match.end > span.start)

  if (containing.length !== 1) return { kind: 'document' }

  const [span] = containing
  const block = span.node

  // Only a block whose content is inline text can accept a streamed character range.
  if (!block.inlineContent) {
    return { kind: 'block', from: span.pos, to: span.pos + block.nodeSize }
  }

  const matched = canonical.slice(match.start, match.end)
  const text = block.textContent
  const offset = text.indexOf(matched)

  // Absent from the plain text means the match includes Markdown syntax.
  if (offset === -1 || text.indexOf(matched, offset + 1) !== -1) {
    return { kind: 'block', from: span.pos, to: span.pos + block.nodeSize }
  }

  return {
    kind: 'inline',
    from: textOffsetToPosition(block, span.pos, offset),
    to: textOffsetToPosition(block, span.pos, offset + matched.length),
  }
}

/**
 * Locates a plain-text run in the editor, for highlighting rather than editing.
 *
 * `resolveTarget` answers "how should this be applied" and widens to a whole
 * block when a match crosses markup. Showing a reader where something matched
 * needs the opposite: the exact characters, even inside a list the apply path
 * would have replaced wholesale.
 */
export function findTextRanges(doc: ProseMirrorNode, needle: string): { from: number; to: number }[] {
  if (!needle) return []

  // A flat transcript of the document's text, with the editor position of each character.
  const positions: number[] = []
  let text = ''
  let previousParent: ProseMirrorNode | null = null

  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return true

    // Block boundaries become newlines so a needle cannot match across them silently.
    if (previousParent && parent !== previousParent) {
      text += '\n'
      positions.push(pos)
    }
    previousParent = parent

    for (let index = 0; index < node.text.length; index += 1) positions.push(pos + index)
    text += node.text
    return true
  })

  const ranges: { from: number; to: number }[] = []
  let cursor = 0

  for (;;) {
    const found = text.indexOf(needle, cursor)
    if (found === -1) return ranges
    ranges.push({ from: positions[found], to: positions[found + needle.length - 1] + 1 })
    cursor = found + needle.length
  }
}
