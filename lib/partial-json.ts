/**
 * Reads a `str_replace` tool input while it is still arriving.
 *
 * `eager_input_streaming` sends tool input as unvalidated JSON fragments, so the
 * buffer is usually not parseable. This decodes as much as is complete, which is
 * what lets the UI locate the target from `old_str` and then stream `new_str`
 * into it as the characters arrive.
 *
 * The built-in text editor tool wraps the same two keys in `command` and `path`,
 * so the same scan reads both tools. Keys it does not know are stepped over.
 */

export interface PartialEditInput {
  /** The built-in tool's command, which selects among `view`, `str_replace`, and the rest. */
  command?: string
  oldStr?: string
  oldStrComplete: boolean
  newStr?: string
  newStrComplete: boolean
  replaceAll?: boolean
}

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

interface StringRead {
  value: string
  complete: boolean
  end: number
}

/** Reads a JSON string starting at the opening quote, decoding what is available. */
function readString(buffer: string, start: number): StringRead {
  let value = ''
  let i = start + 1

  while (i < buffer.length) {
    const char = buffer[i]

    if (char === '"') return { value, complete: true, end: i + 1 }

    if (char !== '\\') {
      value += char
      i += 1
      continue
    }

    // A lone trailing backslash is the front half of an escape still in flight.
    if (i + 1 >= buffer.length) return { value, complete: false, end: buffer.length }

    const escape = buffer[i + 1]
    if (escape === 'u') {
      const hex = buffer.slice(i + 2, i + 6)
      if (hex.length < 4) return { value, complete: false, end: buffer.length }
      value += String.fromCharCode(parseInt(hex, 16))
      i += 6
      continue
    }

    const decoded = ESCAPES[escape]
    if (decoded === undefined) return { value, complete: false, end: buffer.length }
    value += decoded
    i += 2
  }

  return { value, complete: false, end: buffer.length }
}

function skipWhitespace(buffer: string, index: number): number {
  let i = index
  while (i < buffer.length && /\s/.test(buffer[i])) i += 1
  return i
}

export function scanEditInput(buffer: string): PartialEditInput {
  const result: PartialEditInput = { oldStrComplete: false, newStrComplete: false }

  let i = skipWhitespace(buffer, 0)
  if (buffer[i] !== '{') return result
  i += 1

  while (i < buffer.length) {
    i = skipWhitespace(buffer, i)
    if (buffer[i] === '}' || i >= buffer.length) break

    if (buffer[i] !== '"') break
    const key = readString(buffer, i)
    if (!key.complete) break
    i = skipWhitespace(buffer, key.end)

    if (buffer[i] !== ':') break
    i = skipWhitespace(buffer, i + 1)
    if (i >= buffer.length) break

    if (buffer[i] === '"') {
      const value = readString(buffer, i)
      if (key.value === 'old_str') {
        result.oldStr = value.value
        result.oldStrComplete = value.complete
      } else if (key.value === 'new_str') {
        result.newStr = value.value
        result.newStrComplete = value.complete
      } else if (key.value === 'command' && value.complete) {
        result.command = value.value
      }
      if (!value.complete) break
      i = value.end
    } else {
      const end = /[,}]/.exec(buffer.slice(i))
      const literal = (end ? buffer.slice(i, i + end.index) : buffer.slice(i)).trim()
      if (key.value === 'replace_all' && (literal === 'true' || literal === 'false')) {
        result.replaceAll = literal === 'true'
      }
      if (!end) break
      i += end.index
    }

    i = skipWhitespace(buffer, i)
    if (buffer[i] === ',') i += 1
  }

  return result
}
