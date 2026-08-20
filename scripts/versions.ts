/**
 * Asserts the app has one version number rather than three that agree by habit.
 *
 * Nothing at runtime reads these files, so a half-finished bump is invisible
 * until someone opens a disk image labelled with the previous release. That is
 * the wrong place to find out, and it is the only place that currently would.
 *
 * `tauri.conf.json` no longer keeps a copy. It points at `package.json`, which
 * the Tauri config schema accepts in place of a literal, so the bundle version
 * follows the package. Whether it still points there is checked here, because a
 * literal put back by hand reintroduces the drift and nothing else would say so.
 *
 * Cargo keeps the remaining copy in `Cargo.toml`, and `Cargo.lock` records it a
 * second time. The lock is checked because cargo rewrites it from the manifest:
 * a lock left behind means a bump edited the manifest and never ran cargo, so
 * the resolved crate graph disagrees with what is about to be built.
 */
import { readFileSync } from 'node:fs'

const CRATE = 'anthropic-text-editor-inspector'

/** What `tauri.conf.json` holds instead of its own copy. */
const DEFERS_TO = '../package.json'

/** Enough of semver to reject a typo. Cargo and npm both refuse the rest. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

interface Table {
  header: string
  lines: string[]
}

/**
 * Splits a TOML file into its tables.
 *
 * Both Cargo files repeat `version` under every dependency, so a lookup has to
 * be anchored to the table it belongs to. A header line to the next header is
 * all the structure these two need. Writing them is left to cargo, which is
 * where a hand-rolled parser would actually be dangerous.
 */
function tables(source: string): Table[] {
  const found: Table[] = []
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('[')) found.push({ header: line.trim(), lines: [] })
    else found[found.length - 1]?.lines.push(line)
  }
  return found
}

/** `key = "value"`, which is the only form cargo writes for these fields. */
function value(table: Table | undefined, key: string): string | undefined {
  const line = table?.lines.find((entry) => entry.trimStart().startsWith(`${key} =`))
  return line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^"|"$/g, '')
}

const pkg = JSON.parse(read('package.json')) as { version: string }
const tauri = JSON.parse(read('src-tauri/tauri.conf.json')) as { version: string }

const manifest = tables(read('src-tauri/Cargo.toml'))
const lock = tables(read('src-tauri/Cargo.lock'))

const version = pkg.version
const cargoVersion = value(
  manifest.find((table) => table.header === '[package]'),
  'version',
)
const lockVersion = value(
  lock.find((table) => table.header === '[[package]]' && value(table, 'name') === CRATE),
  'version',
)

/** Label, whether it holds, and what was there when it does not. */
const checks: [string, boolean, string | undefined][] = [
  [`package.json is semver: ${version}`, SEMVER.test(version), version],
  [`tauri.conf.json reads ${DEFERS_TO}`, tauri.version === DEFERS_TO, tauri.version],
  [`Cargo.toml matches package.json`, cargoVersion === version, cargoVersion],
  [`Cargo.lock matches package.json`, lockVersion === version, lockVersion],
]

for (const [label, ok, found] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — found ${found ?? 'nothing'}`}`)
}

if (checks.some(([, ok]) => !ok)) {
  console.log(`\n\`bun run bump ${version}\` sets the version everywhere from package.json.`)
  process.exit(1)
}
