import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Workspace } from '@/components/workspace'
import { TooltipProvider } from '@/components/ui/tooltip'
import '@/styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <Workspace />
    </TooltipProvider>
  </StrictMode>,
)
