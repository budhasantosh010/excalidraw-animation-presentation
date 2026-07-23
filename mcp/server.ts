import type { Server as HttpServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

import {
  createAnimationFile,
  listAnimationFiles,
  readAnimationFile,
  reviseAnimationFile,
  validateAnimationDocument,
} from './animation-tools.ts'

export type AnimationMcpConfig = {
  host: '127.0.0.1'
  port: number
  routeSecret: string
  outputDir: string
  allowedHosts: string[]
}

const allowedOrigins = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com',
])

const jsonResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

const createToolServer = (config: AnimationMcpConfig) => {
  const server = new McpServer({
    name: 'sanverse-excalidraw-animation',
    version: '1.0.0',
  })

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
      }),
  )

  server.registerTool(
    'create_animation',
    {
      description:
        'Create one animated Excalidraw file from a structured storyboard.',
      inputSchema: {
        storyboard: z.record(z.any()),
        filename: z.string().optional(),
      },
    },
    async ({ storyboard, filename }) =>
      jsonResult(
        await createAnimationFile(config.outputDir, storyboard, filename),
      ),
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

  return server
}

export const startAnimationMcpServer = async (config: AnimationMcpConfig) => {
  if (config.host !== '127.0.0.1') throw new Error('Host must be 127.0.0.1.')
  if (!/^[A-Za-z0-9_-]{43,}$/.test(config.routeSecret)) {
    throw new Error('Route secret must contain at least 43 URL-safe characters.')
  }

  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  })
  const mcpPath = `/mcp/${config.routeSecret}/`

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
    const server = createToolServer(config)
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
  const running = await startAnimationMcpServer({
    host: '127.0.0.1',
    port: 3002,
    routeSecret,
    outputDir,
    allowedHosts,
  })
  console.log(`Animation MCP listening on 127.0.0.1:${running.port}`)
}
