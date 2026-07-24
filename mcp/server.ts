import type { Server as HttpServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { z } from 'zod'

import {
  createAnimationFile,
  listAnimationFiles,
  readAnimationFile,
  reviseAnimationFile,
  summarizeAnimationDocument,
  validateAnimationDocument,
  type ExcalidrawDocument,
} from './animation-tools.ts'
import {
  loadMcpAppBuild,
  UI_DIST_DIR,
  UI_RESOURCE_URI,
  type McpAppBuild,
} from './ui-assets.ts'

export type AnimationMcpConfig = {
  host: '127.0.0.1'
  port: number
  routeSecret: string
  outputDir: string
  allowedHosts: string[]
  publicOrigin: string
}

const allowedOrigins = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com',
])
/*
const DIAGNOSTIC_UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sanverse Animation Studio</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; padding: 32px; background: Canvas; color: CanvasText; }
      main { max-width: 640px; margin: 0 auto; padding: 24px; border: 1px solid
        color-mix(in srgb, CanvasText 18%, transparent); border-radius: 16px; }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0; opacity: .75; }
    </style>
  </head>
  <body>
    <main>
      <h1>Animation Studio connection proof</h1>
      <p id="status">Connecting to the MCP App host…</p>
    </main>
    <script>
      (() => {
        const requestId = 1;
        const status = document.getElementById('status');
        window.addEventListener('message', (event) => {
          const message = event.data;
          if (
            event.source !== window.parent ||
            !message ||
            message.jsonrpc !== '2.0' ||
            message.id !== requestId
          ) return;
          if (message.error) {
            status.textContent = 'Host handshake failed.';
            return;
          }
          window.parent.postMessage({
            jsonrpc: '2.0',
            method: 'ui/notifications/initialized'
          }, '*');
          window.parent.postMessage({
            jsonrpc: '2.0',
            method: 'ui/notifications/size-changed',
            params: { width: document.body.scrollWidth, height: document.body.scrollHeight }
          }, '*');
          status.textContent = 'Connected to the MCP App host.';
        });
        window.parent.postMessage({
          jsonrpc: '2.0',
          id: requestId,
          method: 'ui/initialize',
          params: {
            appInfo: { name: 'Sanverse Animation Studio Proof', version: '1.0.0' },
            appCapabilities: {},
            protocolVersion: '2026-01-26'
          }
        }, '*');
      })();
    </script>
  </body>
</html>`
*/

const jsonResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

const appProjectResult = (
  summary: Record<string, unknown> & { filename: string; revision: number },
  projectSnapshot: ExcalidrawDocument,
) => ({
  ...jsonResult(summary),
  structuredContent: summary,
  _meta: {
    filename: summary.filename,
    revision: summary.revision,
    uiResourceUri: UI_RESOURCE_URI,
    projectSnapshot,
  },
})

const createToolServer = (
  config: AnimationMcpConfig,
  uiBuild: McpAppBuild,
) => {
  const server = new McpServer({
    name: 'sanverse-excalidraw-animation',
    version: '1.0.0',
  })

  registerAppResource(
    server,
    'Sanverse Animation Studio',
    UI_RESOURCE_URI,
    {
      description:
        'The bundled Sanverse Excalidraw editor and animation player.',
      _meta: {
        ui: {
          csp: {
            resourceDomains: [uiBuild.publicOrigin],
          },
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: uiBuild.bootstrapHtml,
          _meta: {
            ui: {
              csp: {
                resourceDomains: [uiBuild.publicOrigin],
              },
            },
          },
        },
      ],
    }),
  )

  server.registerTool(
    'get_animation_status',
    {
      description: 'Return safe status for the local animation MCP.',
      inputSchema: {},
    },
    async () =>
      jsonResult({
        status: 'ok',
        host: config.host,
        port: config.port,
        outputFormat: '.excalidraw',
        effects: ['auto', 'appear', 'fade', 'pop', 'draw'],
        controlsOpenBrowser: false,
        exportsVideo: false,
        tools: [
          'get_animation_status',
          'create_animation',
          'revise_animation',
          'validate_animation',
          'list_animations',
          'open_animation_studio',
        ],
        uiResourceRegistered: true,
        uiResourceUri: UI_RESOURCE_URI,
      }),
  )

  registerAppTool(
    server,
    'create_animation',
    {
      description:
        'Create one animated Excalidraw file from a structured storyboard.',
      inputSchema: {
        storyboard: z.record(z.any()),
        filename: z.string().optional(),
      },
      _meta: {
        ui: { resourceUri: UI_RESOURCE_URI },
      },
    },
    async ({ storyboard, filename }) => {
      const created = await createAnimationFile(
        config.outputDir,
        storyboard,
        filename,
      )
      const projectSnapshot = await readAnimationFile(
        config.outputDir,
        created.filename,
      )
      const summary = {
        ...created,
        uiResourceUri: UI_RESOURCE_URI,
        uiResourceAttached: true,
      }
      return appProjectResult(summary, projectSnapshot)
    },
  )

  server.registerTool(
    'revise_animation',
    {
      description:
        'Apply small validated text, step, effect, or position changes.',
      inputSchema: {
        filename: z.string(),
        operations: z.array(z.record(z.any())).min(1).max(50),
      },
    },
    async ({ filename, operations }) =>
      jsonResult(
        await reviseAnimationFile(config.outputDir, filename, operations),
      ),
  )

  server.registerTool(
    'validate_animation',
    {
      description: 'Validate one generated animation file.',
      inputSchema: { filename: z.string() },
    },
    async ({ filename }) =>
      jsonResult(
        validateAnimationDocument(
          await readAnimationFile(config.outputDir, filename),
        ),
      ),
  )

  server.registerTool(
    'list_animations',
    {
      description: 'List generated animation filenames.',
      inputSchema: {},
    },
    async () =>
      jsonResult({ filenames: await listAnimationFiles(config.outputDir) }),
  )

  registerAppTool(
    server,
    'open_animation_studio',
    {
      description:
        'Open one existing animation directly in the embedded editor and player.',
      inputSchema: {
        filename: z.string(),
      },
      _meta: {
        ui: { resourceUri: UI_RESOURCE_URI },
      },
    },
    async ({ filename }) => {
      const projectSnapshot = await readAnimationFile(
        config.outputDir,
        filename,
      )
      const validation = validateAnimationDocument(projectSnapshot)
      if (!validation.valid) throw new Error(validation.errors.join(' '))
      const summary = {
        status: 'opened',
        ...summarizeAnimationDocument(filename, projectSnapshot),
        validationStatus: 'valid',
        uiResourceUri: UI_RESOURCE_URI,
        uiResourceAttached: true,
      }
      return appProjectResult(summary, projectSnapshot)
    },
  )

  return server
}

export const startAnimationMcpServer = async (config: AnimationMcpConfig) => {
  if (config.host !== '127.0.0.1') throw new Error('Host must be 127.0.0.1.')
  if (!/^[A-Za-z0-9_-]{43,}$/.test(config.routeSecret)) {
    throw new Error('Route secret must contain at least 43 URL-safe characters.')
  }
  const uiBuild = await loadMcpAppBuild(config.publicOrigin)

  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  })
  const mcpPath = `/mcp/${config.routeSecret}/`

  app.use(
    uiBuild.assetBasePath,
    express.static(UI_DIST_DIR, {
      immutable: true,
      index: false,
      maxAge: '1y',
      redirect: false,
      setHeaders(response) {
        response.setHeader('Access-Control-Allow-Origin', '*')
        response.setHeader(
          'Cross-Origin-Resource-Policy',
          'cross-origin',
        )
      },
    }),
  )

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      app: 'Sanverse Excalidraw Animation',
      host: config.host,
      port: config.port,
    })
  })

  app.use(mcpPath, (request, response, next) => {
    const origin = request.header('origin')
    if (origin && !allowedOrigins.has(origin)) {
      response.status(403).json({ error: 'Forbidden' })
      return
    }
    next()
  })

  app.post(mcpPath, async (request, response) => {
    const server = createToolServer(config, uiBuild)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response, request.body)
    } catch {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        })
      }
    } finally {
      await transport.close()
      await server.close()
    }
  })

  app.get(mcpPath, (_request, response) => {
    response.status(405).set('Allow', 'POST').send('Method Not Allowed')
  })

  const httpServer = await new Promise<HttpServer>((resolveServer, reject) => {
    const listener = app.listen(config.port, config.host, () =>
      resolveServer(listener),
    )
    listener.once('error', reject)
  })
  const address = httpServer.address()
  const port = typeof address === 'object' && address ? address.port : config.port
  config.port = port

  return {
    port,
    close: () =>
      new Promise<void>((resolveClose, reject) =>
        httpServer.close((error) =>
          error ? reject(error) : resolveClose(),
        ),
      ),
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  const routeSecret = process.env.ANIMATION_MCP_SECRET ?? ''
  const outputDir = resolve(
    process.env.ANIMATION_OUTPUT_DIR ?? 'outputs/mcp-animations',
  )
  const allowedHosts = (
    process.env.MCP_ALLOWED_HOSTS ?? '127.0.0.1,localhost'
  )
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
  const publicOrigin = process.env.MCP_PUBLIC_ORIGIN ?? ''
  const running = await startAnimationMcpServer({
    host: '127.0.0.1',
    port: 3002,
    routeSecret,
    outputDir,
    allowedHosts,
    publicOrigin,
  })
  console.log(`Animation MCP listening on 127.0.0.1:${running.port}`)
}
