/**
 * Match semantics for the `str_replace` tool, following Claude Code's Edit tool:
 * a match must be exact and unique, and anything else is refused rather than
 * guessed. A refusal costs one round trip. Guessing wrong costs the user's trust
 * in the document.
 */

export interface Match {
  start: number
  end: number
}

export type MatchOutcome =
  | { ok: true; matches: Match[] }
  /** Failures carry their matches too, so an ambiguous edit can be shown in place. */
  | { ok: false; message: string; matches: Match[] }

export function findAll(source: string, needle: string): Match[] {
  const matches: Match[] = []
  if (!needle) return matches
  let from = 0
  for (;;) {
    const start = source.indexOf(needle, from)
    if (start === -1) return matches
    matches.push({ start, end: start + needle.length })
    from = start + needle.length
  }
}

/** Collapses runs of whitespace so a near-miss can be reported specifically. */
function loosen(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function describeNearMiss(source: string, oldStr: string): string {
  const loose = loosen(oldStr)
  if (loose && loosen(source).includes(loose)) {
    return (
      ' The text is present but differs in whitespace. Table cells are padded to' +
      ' align columns, so copy the target exactly as it appears, including the padding.'
    )
  }
  const firstLine = oldStr.split('\n')[0].trim()
  if (firstLine.length >= 12 && source.includes(firstLine)) {
    return ` The first line ("${firstLine}") is present, so the mismatch is later in old_str.`
  }
  return ''
}

export function locateEdit(source: string, oldStr: string, replaceAll = false): MatchOutcome {
  if (!oldStr) {
    return {
      ok: false,
      matches: [],
      message: 'old_str must not be empty. Provide the exact text to replace.',
    }
  }

  const matches = findAll(source, oldStr)

  if (matches.length === 0) {
    return {
      ok: false,
      matches,
      message:
        'No match for old_str. It must match the document exactly, including whitespace' +
        ' and punctuation.' +
        describeNearMiss(source, oldStr),
    }
  }

  if (matches.length > 1 && !replaceAll) {
    return {
      ok: false,
      matches,
      message:
        `old_str matched ${matches.length} times and must identify exactly one location.` +
        ' Extend it with surrounding text until it is unique, or set replace_all to true' +
        ' to change every occurrence.',
    }
  }

  return { ok: true, matches: replaceAll ? matches : [matches[0]] }
}

/** Applies located matches back-to-front so earlier offsets stay valid. */
export function applyEdit(source: string, matches: Match[], newStr: string): string {
  return [...matches]
    .sort((a, b) => b.start - a.start)
    .reduce((text, match) => text.slice(0, match.start) + newStr + text.slice(match.end), source)
}
