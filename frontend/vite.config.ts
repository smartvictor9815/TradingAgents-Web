import type { ServerResponse } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:18000',
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('error', (_err, _req, res) => {
        const r = res as ServerResponse
        if (!r?.writeHead || r.headersSent || r.writableEnded) return
        r.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
        r.end(
          JSON.stringify({
            detail:
              'Cannot reach the backend API at 127.0.0.1:18000. Start the server first, e.g. .venv/bin/python -m uvicorn app.api.main:app --host 127.0.0.1 --port 18000',
          }),
        )
      })
    },
  },
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: apiProxy,
  },
  preview: {
    port: 3000,
    proxy: apiProxy,
  },
})
