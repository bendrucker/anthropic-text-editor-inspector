import { useCallback } from 'react'
import { useLiveDocument } from '@/hooks/use-live-document'
import { DocumentPane } from './document-pane'
import { ChatPane } from './chat-pane'
import { RunControls } from './run-controls'
import { RunInspector } from './run-inspector'
import { ToolSetup } from './tool-setup'
import { ApiKeyControl } from './api-key-control'
import { DocumentPicker } from './document-picker'
import { Tooltip } from './ui/tooltip'

const SOURCE_URL = 'https://github.com/bendrucker/anthropic-text-editor-inspector'

/**
 * lucide ships no brand icons at any version this app can install, so the mark
 * is inlined instead of imported: GitHub's own `mark-github-16` octicon, path
 * and `viewBox` untouched, with `fill` handed to `currentColor` so the anchor
 * drives it. A dependency for one glyph is not worth it. GitHub's logo guidance
 * allows the Invertocat standalone where the brand is already established, and
 * the accessible name and tooltip both say GitHub.
 *
 * That guidance also fixes the colour to white, black, grey, or green and
 * forbids scaling the mark non-uniformly, which leaves the box as the only
 * tuning dimension. 14px, not the 16 the `Code` chevrons had: a filled mark
 * carries more ink than a two-stroke glyph in the same square, and 16 read
 * heavier than everything else in this header.
 *
 * `slate-500` is the floor rather than the aesthetic pick. The glyph is the
 * whole control, so 1.4.11 applies to it the way #63 applied it to a border,
 * and `slate-400` is the 2.63:1 that PR measured and rejected. It also happens
 * to be what the quietest text in this header already uses.
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

function SourceLink() {
  return (
    <Tooltip content="This app's source on GitHub.">
      <a
        href={SOURCE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Source on GitHub"
        className="focus-ring shrink-0 rounded text-slate-500 transition hover:text-slate-700"
      >
        <GitHubMark />
      </a>
    </Tooltip>
  )
}

export function Workspace() {
  const doc = useLiveDocument()
  const { send } = doc

  const askAboutSelection = useCallback(
    (selection: string, prompt: string) => send(prompt, selection),
    [send],
  )

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* One row is only honest while both halves fit in it. Below `md` the two
          halves stack, because the alternative is every control in the right
          half wrapping its own label into a column. */}
      <header className="flex flex-col gap-2 border-b border-slate-200 px-6 py-3 md:flex-row md:items-center md:justify-between">
        {/* Far right is where a source link usually goes, and it does not fit
            there. At 480 the controls half is 407px of content in a 432px row,
            and an icon plus that half's gap needs 32: it wraps, and the header
            grows from 94px to 118px. This half is the one built to give way, so
            the 28px comes out of the description, which truncates for a living
            and still reads 271px wide at 1024. */}
        <div className="flex min-w-0 items-center gap-3">
          <SourceLink />
          <DocumentPicker
            document={doc.document}
            generated={doc.generated}
            onSelect={doc.selectDocument}
            onGenerate={doc.generate}
            disabled={doc.running}
          />
          {/* Truncation stops paying somewhere above a stub: at 650px this had
              shrunk to one letter and an ellipsis. The document select's own
              tooltip carries the same sentence, so dropping it loses nothing. */}
          <span className="hidden truncate text-xs text-slate-500 lg:block">
            {doc.document.description}
          </span>
        </div>

        {/* `shrink-0` settles which half gives way first. Without it the run
            controls compress and wrap while the description beside them keeps
            its full width, which is backwards: the description truncates
            gracefully and a control does not. */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
          {/* A live region announces text that changes inside it, so this
              container has to outlive the run rather than appear with it. The
              end of a run leaves nothing on screen at all, which is what the
              invisible half is for. */}
          <span
            role="status"
            className={doc.running ? 'flex items-center gap-2 text-xs text-slate-500' : 'sr-only'}
          >
            {doc.running ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                Editing
              </>
            ) : (
              doc.runs.length > 0 && 'Run finished'
            )}
          </span>
          <RunControls
            model={doc.model}
            onModel={doc.setModel}
            fastMode={doc.fastMode}
            onFastMode={doc.setFastMode}
            fastAvailable={doc.fastAvailable}
            effort={doc.effort}
            onEffort={doc.setEffort}
            effortAvailable={doc.effortAvailable}
            disabled={doc.running}
          />
          <ApiKeyControl apiKey={doc.apiKey} onApiKey={doc.setApiKey} />
        </div>
      </header>

      <ToolSetup
        editorTool={doc.editorTool}
        onEditorTool={doc.setEditorTool}
        guardrails={doc.guardrails}
        onGuardrails={doc.setGuardrails}
        oldStrFirst={doc.oldStrFirst}
        onOldStrFirst={doc.setOldStrFirst}
        eagerStreaming={doc.eagerStreaming}
        onEagerStreaming={doc.setEagerStreaming}
        disabled={doc.running}
      />

      {/* `1fr` is `minmax(auto,1fr)`, so the document column is floored by its
          own min-content. A wide table sets that floor, the row grows past the
          viewport, and `overflow-hidden` clips the composer off the right edge
          with nothing to scroll. `minmax(0,1fr)` drops the floor. Nothing new
          has to scroll to absorb the slack: a wide table already scrolls in its
          own `.tableWrapper`, and `data-document-scroll` is `overflow-y-auto`,
          which computes `overflow-x` to `auto`. */}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] overflow-hidden">
        <DocumentPane
          initialMarkdown={doc.document.markdown}
          locked={doc.running}
          onEditor={doc.setEditor}
          onAskAboutSelection={askAboutSelection}
        />
        <ChatPane
          prompts={doc.document.prompts}
          traps={doc.traps}
          conversation={doc.conversation}
          running={doc.running}
          replaying={doc.replaying}
          hasKey={Boolean(doc.apiKey)}
          error={doc.error}
          onSend={doc.send}
          onStop={doc.stop}
          onRevert={doc.revert}
        />
      </main>

      <RunInspector
        timeline={doc.timeline}
        buffer={doc.buffer}
        canonical={doc.currentMarkdown}
        probes={doc.probes}
        runs={doc.runs}
        onShowMatches={doc.showMatches}
        onReplay={doc.replay}
        replaying={doc.replaying}
        recorded={doc.recorded}
      />
    </div>
  )
}
