import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { Toaster } from 'sonner'

import { router } from './routes'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Toaster 
      position="top-right" 
      toastOptions={{
        style: {
          background: '#0d1117',
          color: '#ffffff',
        },
      }}
      icons={{
        success: <span style={{ color: '#3fb950' }}>✓</span>,
        error: <span style={{ color: '#f85149' }}>✗</span>,
        info: <span style={{ color: '#58a6ff' }}>ℹ</span>,
        warning: <span style={{ color: '#ffa657' }}>⚠</span>,
      }}
    />
  </StrictMode>,
)
