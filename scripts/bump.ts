/**
 * Sets the version the next release is built from.
 *
 * `package.json` is the number. `tauri.conf.json` reads it from there, so the
 * disk image is labelled from the package without a copy to keep in step.
 * Cargo keeps its own in `Cargo.toml`, which is edited here, and records it
 * again in `Cargo.lock`, which is not: cargo is asked to rewrite that. Editing
 * a lockfile by hand works until a dependency changes shape, and the failure
 * then lands on whoever next runs a build rather than on whoever bumped.
 *
 * `bun run versions` asserts the result, and runs last here so a bump that only
 * half-applied fails now instead of at the tag.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const CRATE = 'anthropic-text-editor-inspector'
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const root = new URL('..', import.meta.url)
const next = process.argv[2]

if (!next || !SEMVER.test(next)) {
  console.error(`Usage: bun run bump <version>, where version is semver.`)
  console.error(`Got: ${next ?? 'nothing'}`)
  process.exit(1)
}

/**
 * Rewrites one line, so the file keeps the formatting it was checked in with.
 *
 * `search` is scoped by the caller to the region that owns the key, since both
 * of these files carry the same key under every dependency they list.
 */
function replaceLine(path: string, search: (line: string) => boolean, replacement: string) {
  const url = new URL(path, root)
  const lines = readFileSync(url, 'utf8').split('\n')
  const at = lines.findIndex(search)
  if (at === -1) throw new Error(`${path} has no line to replace`)
  const before = lines[at]
  lines[at] = replacement
  writeFileSync(url, lines.join('\n'))
  // The value is the last quoted run on the line in both files, which the key
  // in `"version": "0.1.0",` is not.
  return before.match(/"([^"]*)"\s*,?\s*$/)?.[1] ?? before.trim()
}

// The only top-level key at this indent. Dependency versions are values, not
// keys, so none of them can match.
const wasPackage = replaceLine(
  'package.json',
  (line) => /^ {2}"version": "/.test(line),
  `  "version": "${next}",`,
)

// `[package]` is the first table in the manifest, so its version is the first
// bare `version =` in the file. Dependency versions are indented inside a table
// of their own or written inline in braces.
const wasCargo = replaceLine(
  'src-tauri/Cargo.toml',
  (line) => /^version = "/.test(line),
  `version = "${next}"`,
)

console.log(`package.json  ${wasPackage} → ${next}`)
console.log(`Cargo.toml    ${wasCargo} → ${next}`)

// Re-resolving just this package rewrites its recorded version and leaves every
// dependency where the lock already pinned it.
execFileSync(
  'cargo',
  ['update', '--offline', '--manifest-path', 'src-tauri/Cargo.toml', '--package', CRATE],
  { cwd: root, stdio: 'inherit' },
)

execFileSync('bun', ['run', 'versions'], { cwd: root, stdio: 'inherit' })
