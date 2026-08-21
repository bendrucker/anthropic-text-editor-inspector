import { Info } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog'
import { Tooltip } from './ui/tooltip'

const SOURCE_URL = 'https://github.com/bendrucker/anthropic-text-editor-inspector'
const AUTHOR_URL = 'https://bendrucker.me'

/** A second fact about this app is another row in the column, at no layout cost. */
export function AppInfo() {
  return (
    <Dialog>
      <Tooltip content="Who made this app and where its source lives.">
        <DialogTrigger
          aria-label="About this app"
          className="focus-ring shrink-0 rounded text-slate-500 transition hover:text-slate-700"
        >
          <Info className="size-4" />
        </DialogTrigger>
      </Tooltip>

      <DialogContent title="About this app">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-xs text-slate-500">
            Created by:{' '}
            <a
              href={AUTHOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring rounded font-medium text-slate-700 underline underline-offset-2 transition hover:text-slate-900"
            >
              Ben Drucker
            </a>
          </p>

          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub"
            className="focus-ring flex flex-col items-center gap-1.5 rounded px-2 py-1 text-slate-500 transition hover:text-slate-700"
          >
            <GitHubMark />
            <span className="text-[11px]">View source</span>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * lucide ships no brand icons at any version this app can install, so the mark
 * is inlined instead of imported: GitHub's own `mark-github-16` octicon, path
 * and `viewBox` untouched, with `fill` handed to `currentColor` so the anchor
 * drives it. A dependency for one glyph is not worth it. GitHub's logo guidance
 * allows the Invertocat standalone where the brand is already established, and
 * the accessible name says GitHub.
 *
 * That guidance also fixes the colour to white, black, grey, or green and
 * forbids scaling the mark non-uniformly, which leaves the box as the only
 * tuning dimension. 14px, not the 16 the `Code` chevrons had: a filled mark
 * carries more ink than a two-stroke glyph in the same square, and 16 read
 * heavier than everything else around it.
 *
 * `slate-500` is the floor rather than the aesthetic pick. The glyph is half of
 * a control whose other half is 11px text, so 1.4.11 applies to it the way #63
 * applied it to a border, and `slate-400` is the 2.63:1 that PR measured and
 * rejected.
 */
function GitHubMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="h-3.5 w-3.5"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}
