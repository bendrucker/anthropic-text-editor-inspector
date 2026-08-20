import { useCallback } from 'react'
import { useLiveDocument } from '@/hooks/use-live-document'
import { DocumentPane } from './document-pane'
import { ChatPane } from './chat-pane'
import { RunControls } from './run-controls'
import { RunInspector } from './run-inspector'
import { ToolSetup } from './tool-setup'
import { ApiKeyControl } from './api-key-control'
import { DocumentPicker } from './document-picker'

export function Workspace() {
  const doc = useLiveDocument()
  const { send } = doc

  const askAboutSelection = useCallback(
    (selection: string, prompt: string) => send(prompt, selection),
    [send],
  )

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <DocumentPicker
            document={doc.document}
            generated={doc.generated}
            onSelect={doc.selectDocument}
            onGenerate={doc.generate}
            disabled={doc.running}
          />
          <span className="truncate text-xs text-slate-400">{doc.document.description}</span>
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
          initialMarkdown={doc.document.markdown}
          locked={doc.running}
          onEditor={doc.setEditor}
          onAskAboutSelection={askAboutSelection}
        />
        <ChatPane
          prompts={doc.document.prompts}
          traps={doc.traps}
          conversation={doc.conversation}
          runs={doc.runs}
          running={doc.running}
          replaying={doc.replaying}
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
        probes={doc.probes}
        onShowMatches={doc.showMatches}
        onReplay={doc.replay}
        replaying={doc.replaying}
        recorded={doc.recorded}
      />
    </div>
  )
}
