/**
 * Matcher inputs derived from the document rather than declared alongside it.
 *
 * A trap is a prompt that names a string appearing more than once, so the first
 * `old_str` the model tries matches several places and the tool refuses it.
 * Hand-written traps only stay true for the document they were written against,
 * which rules them out for a library and for generated documents. These are
 * found by scanning the canonical text, and every one is verified ambiguous
 * before it is offered.
 */
import { findAll, locateEdit } from './str-replace'

export interface Trap {
  needle: string
  prompt: string
  why: string
}

type Kind = 'percent' | 'money' | 'code' | 'label' | 'term'

interface Candidate {
  needle: string
  kind: Kind
  count: number
}

/**
 * Shapes a person would name verbatim when asking for a change. Ordered by how
 * naturally a request quotes them, which is also the ranking preference.
 */
const PATTERNS: { kind: Kind; pattern: RegExp }[] = [
  { kind: 'percent', pattern: /-?\d+(?:\.\d+)?%/g },
  { kind: 'money', pattern: /\$\d[\d,]*(?:\.\d+)?[MKB]?/g },
  { kind: 'label', pattern: /\b[A-Z][A-Za-z]{3,15}\b/g },
  { kind: 'code', pattern: /\b\d{3}\b/g },
  { kind: 'term', pattern: /\b[a-z]{7,15}\b/g },
]

const KIND_RANK: Record<Kind, number> = {
  percent: 0,
  money: 1,
  label: 2,
  code: 3,
  term: 4,
}

/**
 * Words that carry no subject matter. A trap built on one reads as a riddle
 * rather than a request, even when the string really is ambiguous.
 */
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'already', 'although', 'always',
  'another', 'anything', 'because', 'been', 'before', 'being', 'below', 'better',
  'between', 'both', 'cannot', 'could', 'during', 'each', 'either', 'enough',
  'every', 'everything', 'from', 'further', 'have', 'having', 'here', 'however',
  'into', 'itself', 'less', 'more', 'most', 'much', 'must', 'neither', 'never',
  'nothing', 'often', 'only', 'other', 'over', 'rather', 'same', 'should',
  'since', 'some', 'something', 'still', 'such', 'than', 'that', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'though',
  'through', 'together', 'toward', 'under', 'until', 'very', 'were', 'what',
  'when', 'where', 'whether', 'which', 'while', 'will', 'with', 'within',
  'without', 'would', 'your',
])

/** A trap wants a string repeated enough to be ambiguous and few enough to read. */
const MIN_OCCURRENCES = 2
const MAX_OCCURRENCES = 6

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * How often the string appears as a token in its own right. "4%" occurs twice
 * inside "14%" and "24%" without ever standing alone, and a trap built on it
 * would name something the reader cannot find.
 */
function standaloneCount(canonical: string, needle: string): number {
  const bounded = new RegExp(`(?<![\\w$.%])${escape(needle)}(?![\\w%])`, 'g')
  return [...canonical.matchAll(bounded)].length
}

function collect(canonical: string): Candidate[] {
  const seen = new Map<string, Candidate>()

  for (const { kind, pattern } of PATTERNS) {
    for (const match of canonical.matchAll(pattern)) {
      const needle = match[0]
      if (seen.has(needle)) continue
      if (STOPWORDS.has(needle.toLowerCase())) continue

      const count = findAll(canonical, needle).length
      if (count < MIN_OCCURRENCES || count > MAX_OCCURRENCES) continue

      // Every occurrence has to be a real one, or the count the UI prints is a lie.
      if (standaloneCount(canonical, needle) !== count) continue

      seen.set(needle, { needle, kind, count })
    }
  }

  return [...seen.values()]
}

/**
 * Drops a candidate that never appears on its own. "Ridge" occurring exactly as
 * often as "North Ridge" is not a second trap, it is the same one spelled short.
 */
function independent(candidates: Candidate[]): Candidate[] {
  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other.needle !== candidate.needle &&
          other.count === candidate.count &&
          other.needle.includes(candidate.needle),
      ),
  )
}

/**
 * Prefers the kinds a request quotes most naturally. Among those, a string
 * appearing three to five times makes the sharpest trap: twice is thin, and
 * beyond five the highlighted document turns into noise.
 */
function spread(count: number): number {
  if (count < 3) return (3 - count) * 1.5
  return Math.max(0, (count - 5) * 0.5)
}

function score(candidate: Candidate): number {
  return KIND_RANK[candidate.kind] * 10 + spread(candidate.count) + candidate.needle.length / 20
}

/** Nudges a figure so the prompt asks for a specific, checkable change. */
function bump(figure: string): string {
  return figure.replace(/\d+(?:\.\d+)?/, (number) => {
    const decimals = number.split('.')[1]?.length ?? 0
    const next = Number(number) + (decimals > 0 ? 0.2 : 1)
    return next.toFixed(decimals)
  })
}

function phrase(candidate: Candidate): string {
  switch (candidate.kind) {
    case 'percent':
    case 'money':
      return `The ${candidate.needle} figure should read ${bump(candidate.needle)}.`
    case 'code':
      return `Wrap ${candidate.needle} in backticks.`
    default:
      return `Italicize the word ${candidate.needle}.`
  }
}

/**
 * Traps for a document, verified against it. The prompt is phrased in the
 * singular so the model targets one location, which is what makes several
 * matches a refusal rather than a legitimate `replace_all`.
 */
export function deriveTraps(canonical: string, limit = 3): Trap[] {
  const ranked = independent(collect(canonical)).sort((a, b) => score(a) - score(b))
  const traps: Trap[] = []

  for (const candidate of ranked) {
    if (traps.length === limit) break

    // The matcher is the authority on ambiguity, so ask it rather than trusting the count.
    const outcome = locateEdit(canonical, candidate.needle)
    if (outcome.ok || outcome.matches.length < 2) continue

    traps.push({
      needle: candidate.needle,
      prompt: phrase(candidate),
      why: `"${candidate.needle}" appears ${outcome.matches.length} times`,
    })
  }

  return traps
}

export interface Probe {
  label: string
  oldStr: string
  note: string
}

/** The widest run of spaces the serializer inserts is column padding. */
function collapsePadding(row: string): string {
  return row.replace(/ {2,}/g, ' ')
}

function paddedTableRow(canonical: string): string | undefined {
  return canonical
    .split('\n')
    .find((line) => /^\|.*\|$/.test(line) && !/^\|[\s-|]*\|$/.test(line) && / {2,}/.test(line))
}

/**
 * A real fragment with one word dropped. Quoting from memory and losing a word
 * is how a near miss actually happens, and it reads exactly like the document
 * because it is the document. Verified absent before it is offered.
 */
function nearMiss(canonical: string): string | undefined {
  const prose = canonical
    .split('\n')
    .find((line) => line.length > 60 && !line.startsWith('#') && !line.startsWith('|'))
  if (!prose) return undefined

  const words = prose.split(' ').slice(0, 10)
  if (words.length < 6) return undefined

  const dropped = [...words.slice(0, 3), ...words.slice(4)].join(' ')
  return findAll(canonical, dropped).length === 0 ? dropped : undefined
}

/**
 * Presets for the matcher panel, each reaching a different rejection. They are
 * built from the open document, since a string quoted from another one would
 * demonstrate nothing except that it is missing.
 */
export function deriveProbes(canonical: string, traps: Trap[]): Probe[] {
  const probes: Probe[] = []

  const [first] = traps
  if (first) {
    probes.push({
      label: 'Ambiguous',
      oldStr: first.needle,
      note: `${first.why}. Rejected as ambiguous.`,
    })
  }

  const row = paddedTableRow(canonical)
  if (row) {
    probes.push({
      label: 'Unpadded row',
      oldStr: collapsePadding(row),
      note: 'A real row with its column padding collapsed. Rejected on whitespace.',
    })
  }

  const missed = nearMiss(canonical)
  if (missed) {
    probes.push({
      label: 'Near miss',
      oldStr: missed,
      note: 'A real sentence with one word dropped. Rejected as not found.',
    })
  }

  return probes
}
