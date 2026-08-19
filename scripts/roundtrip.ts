/**
 * Round-trip pre-flight.
 *
 * The agent edits the document by matching `old_str` against the Markdown it was
 * shown. If parsing Markdown into the editor and serializing it back is not
 * byte-for-byte stable, the model builds `old_str` from one string while the
 * matcher searches a different one, and edits fail in ways that look random.
 *
 * This asserts stability before any of that machinery exists.
 */
import { readFileSync } from 'node:fs'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'

const extensions = [StarterKit, TableKit]
const manager = new MarkdownManager({ extensions })

// The serializer emits no trailing newline, so compare without one.
const source = readFileSync(new URL('../content/pipeline-review.md', import.meta.url), 'utf8').trimEnd()

const once = manager.serialize(manager.parse(source)).trimEnd()
const twice = manager.serialize(manager.parse(once)).trimEnd()

function firstDivergence(a: string, b: string): string {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
    if (aLines[i] !== bLines[i]) {
      return [
        `line ${i + 1}`,
        `  expected: ${JSON.stringify(aLines[i])}`,
        `  actual:   ${JSON.stringify(bLines[i])}`,
      ].join('\n')
    }
  }
  return '(no line-level difference)'
}

const sourceStable = once === source
const idempotent = twice === once

console.log(`source -> parse -> serialize matches source: ${sourceStable}`)
console.log(`serialize is idempotent:                     ${idempotent}`)

if (!sourceStable) {
  console.log('\nSource differs from its own round trip:')
  console.log(firstDivergence(source, once))
}
if (!idempotent) {
  console.log('\nSerializer is not idempotent:')
  console.log(firstDivergence(once, twice))
}

// The model is shown serializer output, so the serializer only has to be a fixed point.
process.exit(idempotent ? 0 : 1)
