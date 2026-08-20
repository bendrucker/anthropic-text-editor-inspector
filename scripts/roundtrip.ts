/**
 * Round-trip pre-flight for every document the app can open.
 *
 * The agent edits the document by matching `old_str` against the Markdown it was
 * shown. If parsing Markdown into the editor and serializing it back is not
 * byte-for-byte stable, the model builds `old_str` from one string while the
 * matcher searches a different one, and edits fail in ways that look random.
 *
 * Two properties are checked. Serializing has to be a fixed point, or matching
 * drifts as soon as an edit lands. The checked-in source has to already be that
 * fixed point, because the trap derivation reads the file's own text rather than
 * a serialized copy of it.
 *
 * Generated documents are checked the same way. They are built to be canonical
 * by construction, and this is what keeps that true.
 *
 * The library's lead prompts are checked last. Each quotes a run of prose that
 * has to resolve to a streaming inline edit, and the library verifies that as it
 * loads, so importing it is the check.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { generateDocument } from '../lib/generate-document'
import { deriveTraps } from '../lib/traps'

const manager = new MarkdownManager({ extensions: [StarterKit, TableKit] })

const SEEDS = [1, 2, 3, 4, 7, 13, 64, 512]

interface Subject {
  name: string
  source: string
}

const contentDir = new URL('../content/', import.meta.url)

const subjects: Subject[] = [
  ...readdirSync(contentDir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    // The serializer emits no trailing newline, so compare without one.
    .map((file) => ({
      name: file,
      source: readFileSync(new URL(file, contentDir), 'utf8').trimEnd(),
    })),
  ...SEEDS.map((seed) => {
    const document = generateDocument(seed)
    return { name: `generated seed ${seed}`, source: document.markdown }
  }),
]

function firstDivergence(a: string, b: string): string {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
    if (aLines[i] !== bLines[i]) {
      return [
        `  line ${i + 1}`,
        `    expected: ${JSON.stringify(aLines[i])}`,
        `    actual:   ${JSON.stringify(bLines[i])}`,
      ].join('\n')
    }
  }
  return '  (no line-level difference)'
}

let failed = 0

for (const { name, source } of subjects) {
  const once = manager.serialize(manager.parse(source)).trimEnd()
  const twice = manager.serialize(manager.parse(once)).trimEnd()

  const sourceStable = once === source
  const idempotent = twice === once
  // A document nobody can trip over teaches nothing, so an empty set is a defect.
  const traps = deriveTraps(once)

  const ok = sourceStable && idempotent && traps.length > 0
  if (!ok) failed++

  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(24)}` +
      `canonical source: ${String(sourceStable).padEnd(5)}` +
      ` idempotent: ${String(idempotent).padEnd(5)}` +
      ` traps: ${traps.length}`,
  )

  if (!sourceStable) {
    console.log('  source differs from its own round trip:')
    console.log(firstDivergence(source, once))
  }
  if (!idempotent) {
    console.log('  serializer is not idempotent:')
    console.log(firstDivergence(once, twice))
  }
  if (traps.length === 0) {
    console.log('  no repeated string found, so the document offers no ambiguity trap')
  }
}

/**
 * The library is imported here rather than at the top because a source that has
 * stopped being canonical also breaks the block mapping its lead prompts resolve
 * through, and that divergence is the root cause worth reading first.
 */
let leadPrompts: string
let promptsOk = true
try {
  const { SAMPLES } = await import('../lib/library')
  leadPrompts = `${SAMPLES.length} lead prompts resolve inline`
} catch (error) {
  promptsOk = false
  leadPrompts = `lead prompt unusable: ${error instanceof Error ? error.message : String(error)}`
}

console.log(`\n${subjects.length - failed}/${subjects.length} documents stable`)
console.log(leadPrompts)
process.exit(failed === 0 && promptsOk ? 0 : 1)
