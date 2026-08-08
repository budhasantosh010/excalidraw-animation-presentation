import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'

import { summarizeAnimationDocument } from './animation-tools.ts'
import { R2AnimationStore, type R2BucketLike } from './cloud-storage.ts'
import { UI_RESOURCE_URI } from './ui-assets.ts'

const allowedOrigins = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com',
])
const iconifyOrigin = 'https://api.iconify.design'

export type CloudMcpContext = {
  bucket: R2BucketLike
  publicOrigin: string
}

const jsonResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

const appProjectResult = (
  summary: Record<string, unknown> & { filename: string; revision: number },
  projectSnapshot: Awaited<ReturnType<R2AnimationStore['read']>>,
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

const normalizeOrigin = (value: string) => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.origin !== value) {
    throw new Error('publicOrigin must be an HTTPS origin.')
  }
  return url.origin
}

const bootstrapHtml = (publicOrigin: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sanverse Animation Studio</title>
    <script>
      window.__SANVERSE_ASSET_FAILURE__ = () => {
        const error = document.getElementById('asset-load-error');
        if (error) error.hidden = false;
      };
      window.setTimeout(() => {
        if (!window.__SANVERSE_MCP_APP_MOUNTED__) {
          window.__SANVERSE_ASSET_FAILURE__();
        }
      }, 15000);
    </script>
    <link rel="stylesheet" href="${publicOrigin}/mcp-app-assets/animation-studio.css" onerror="window.__SANVERSE_ASSET_FAILURE__()">
  </head>
  <body>
    <div id="root">
      <main role="status" style="padding:24px;font-family:system-ui">
        <h1>Sanverse Animation Studio</h1>
        <p>Loading the editor and project...</p>
      </main>
    </div>
    <aside id="asset-load-error" role="alert" hidden style="position:fixed;inset:0;z-index:9999;padding:24px;background:Canvas;color:CanvasText;font-family:system-ui">
      <h1>Animation Studio failed to load</h1>
      <p>The production asset bundle could not be loaded. Refresh the ChatGPT app after the MCP server is healthy.</p>
    </aside>
    <script type="module" src="${publicOrigin}/mcp-app-assets/animation-studio.js" onerror="window.__SANVERSE_ASSET_FAILURE__()"></script>
  </body>
</html>`

const createToolServer = (context: CloudMcpContext) => {
  const publicOrigin = normalizeOrigin(context.publicOrigin)
  const store = new R2AnimationStore(context.bucket)
  const server = new McpServer({
    name: 'sanverse-excalidraw-animation-cloud',
    version: '1.0.0',
  })

  registerAppResource(
    server,
    'Sanverse Animation Studio',
    UI_RESOURCE_URI,
    {
      description: 'The hosted Sanverse Excalidraw editor and animation player.',
      _meta: {
        ui: {
          csp: {
            resourceDomains: [publicOrigin],
            connectDomains: [iconifyOrigin],
          },
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: bootstrapHtml(publicOrigin),
          _meta: {
            ui: {
              csp: {
                resourceDomains: [publicOrigin],
                connectDomains: [iconifyOrigin],
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
      description: 'Return safe status for the hosted animation MCP.',
      inputSchema: {},
    },
    async () =>
      jsonResult({
        status: 'ok',
        runtime: 'cloudflare-worker',
        outputFormat: '.excalidraw',
        effects: ['auto', 'appear', 'fade', 'pop', 'draw'],
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
      description: 'Create one animated Excalidraw file from a structured storyboard.',
      inputSchema: {
        storyboard: z.record(z.any()),
        filename: z.string().optional(),
      },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async ({ storyboard, filename }) => {
      const created = await store.create(storyboard, filename)
      const projectSnapshot = await store.read(created.filename)
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
      description: 'Apply small validated text, step, effect, or position changes.',
      inputSchema: {
        filename: z.string(),
        operations: z.array(z.record(z.any())).min(1).max(50),
      },
    },
    async ({ filename, operations }) =>
      jsonResult(await store.revise(filename, operations)),
  )

  server.registerTool(
    'validate_animation',
    {
      description: 'Validate one generated animation file.',
      inputSchema: { filename: z.string() },
    },
    async ({ filename }) => jsonResult(await store.validate(filename)),
  )

  server.registerTool(
    'list_animations',
    {
      description: 'List generated animation filenames.',
      inputSchema: {},
    },
    async () => jsonResult({ filenames: await store.list() }),
  )

  registerAppTool(
    server,
    'open_animation_studio',
    {
      description: 'Open one existing animation in the embedded editor and player.',
      inputSchema: { filename: z.string() },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async ({ filename }) => {
      const projectSnapshot = await store.read(filename)
      const validation = await store.validate(filename)
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

export const handleCloudMcpRequest = async (
  request: Request,
  context: CloudMcpContext,
) => {
  const origin = request.headers.get('origin')
  if (origin && !allowedOrigins.has(origin)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const server = createToolServer(context)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(request)
  } finally {
    await transport.close()
    await server.close()
  }
}
