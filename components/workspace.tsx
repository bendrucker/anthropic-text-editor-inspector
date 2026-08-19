import { useCallback } from 'react'
import { useLiveDocument } from '@/hooks/use-live-document'
import { DocumentPane } from './document-pane'
import { ChatPane } from './chat-pane'
import { RunControls } from './run-controls'
import { RunInspector } from './run-inspector'
import { ToolSetup } from './tool-setup'
import { ApiKeyControl } from './api-key-control'

export function Workspace({ initialMarkdown }: { initialMarkdown: string }) {
  const doc = useLiveDocument()
  const { send } = doc

  const askAboutSelection = useCallback(
    (selection: string, prompt: string) => send(prompt, selection),
    [send],
  )

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold text-slate-900">Q3 FY26 Pipeline Review</h1>
          <span className="text-xs text-slate-400">Markdown · live edit</span>
        </div>

        <div className="flex items-center gap-4">
          {doc.running && (
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              Editing
            </span>
          )}
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
        guardrails={doc.guardrails}
        onGuardrails={doc.setGuardrails}
        oldStrFirst={doc.oldStrFirst}
        onOldStrFirst={doc.setOldStrFirst}
        eagerStreaming={doc.eagerStreaming}
        onEagerStreaming={doc.setEagerStreaming}
        disabled={doc.running}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_380px] overflow-hidden">
        <DocumentPane
          initialMarkdown={initialMarkdown}
          locked={doc.running}
          onEditor={doc.setEditor}
          onAskAboutSelection={askAboutSelection}
        />
        <ChatPane
          messages={doc.messages}
          edits={doc.edits}
          runs={doc.runs}
          running={doc.running}
          hasKey={Boolean(doc.apiKey)}
          error={doc.error}
          onSend={doc.send}
          onStop={doc.stop}
          onRevert={doc.revert}
        />
      </div>

      <RunInspector
        timeline={doc.timeline}
        buffer={doc.buffer}
        canonical={doc.currentMarkdown}
        onShowMatches={doc.showMatches}
        onReplay={doc.replay}
        replaying={doc.replaying}
        recorded={doc.recorded}
      />
    </div>
  )
}
