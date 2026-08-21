import { useCallback } from 'react'
import { useLiveDocument } from '@/hooks/use-live-document'
import { DocumentPane } from './document-pane'
import { ChatPane } from './chat-pane'
import { RunControls } from './run-controls'
import { RunInspector } from './run-inspector'
import { ToolSetup } from './tool-setup'
import { ApiKeyControl } from './api-key-control'
import { DocumentPicker } from './document-picker'
import { AppInfo } from './app-info'

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
        <div className="flex min-w-0 items-center gap-3">
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
          {/* A peer of the control groups, on this row's `gap-x-4`. At the
              `gap-2` a group uses internally, the icon reads as a hint on the
              key control beside it, which is the one thing it does not
              describe.

              The 16px of icon and 16px of gap are what this half could not
              spare when the source link was measured into the other one. It
              still cannot: the wrap that grows the header from 94px to 118px
              moves from 405px to 440px. That band sits below where this app
              has a layout at all, since `main` holds a 380px chat rail beside
              the document. */}
          <AppInfo />
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
