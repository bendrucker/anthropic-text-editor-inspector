import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Workspace } from '@/components/workspace'
import initialMarkdown from '@/content/pipeline-review.md?raw'
import '@/styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Workspace initialMarkdown={initialMarkdown.trimEnd()} />
  </StrictMode>,
)
