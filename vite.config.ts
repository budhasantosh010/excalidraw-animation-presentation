import { resolve } from 'node:path'

import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

import { createWorkspaceApi } from './mcp/workspace-api.ts'

const workspaceApi = (): Plugin => ({
  name: 'sanverse-local-workspace-api',
  apply: 'serve',
  async configureServer(server) {
    const api = await createWorkspaceApi(
      resolve(__dirname, '.sanverse-animation-data'),
    )
    server.middlewares.use(
      '/api',
      api.router as unknown as Connect.NextHandleFunction,
    )
    server.httpServer?.once('close', api.close)
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [workspaceApi(), react()],
})
