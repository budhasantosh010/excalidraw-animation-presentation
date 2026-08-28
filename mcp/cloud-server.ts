import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'

import {
  applyRevisionOperations,
  summarizeAnimationDocument,
  validateAnimationDocument,
  type ExcalidrawDocument,
} from './animation-tools.ts'
import { R2AnimationStore, type R2BucketLike } from './cloud-storage.ts'
import { R2WorkspaceStore } from './cloud-workspace-store.ts'
import {
  buildCreationReceipt,
  buildMutationReceipt,
  buildProjectActionReceipt,
  buildProjectIndex,
} from './project-index.ts'
import {
  projectActionSchema,
  projectInspectionShape,
  revisionOperationSchema,
  storyboardSchema,
} from './tool-contracts.ts'
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
  additions: Record<string, unknown> = {},
) => ({
  ...jsonResult({ ...summary, ...additions }),
  structuredContent: { ...summary, ...additions },
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
    <link rel="stylesheet" href="${publicOrigin}/mcp-app/animation-studio.css" onerror="window.__SANVERSE_ASSET_FAILURE__()">
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
    <script type="module" src="${publicOrigin}/mcp-app/animation-studio.js" onerror="window.__SANVERSE_ASSET_FAILURE__()"></script>
  </body>
</html>`

const createToolServer = (context: CloudMcpContext) => {
  const publicOrigin = normalizeOrigin(context.publicOrigin)
  const store = new R2AnimationStore(context.bucket)
  const projects = new R2WorkspaceStore(context.bucket)
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
        exportsVideo: 'browser-dependent',
        exportFormats: ['excalidraw', 'json', 'png', 'svg', 'webm', 'mp4-when-supported'],
        durableProjects: true,
        optimisticRevisionControl: true,
        build: {
          gitSha: 'sites-deployment',
          buildTime: 'sites-deployment',
          schemaVersion: 2,
          storageVersion: 2,
        },
        capabilities: {
          persistence: {
            workspaces: true,
            autosave: true,
            crashRecovery: 'browser-local-journal',
            revisionHistory: true,
            thumbnails: 'not-integrated',
          },
          animation: {
            presets: ['auto', 'appear', 'fade', 'pop', 'draw'],
            transforms: true,
            easing: true,
            stagger: true,
            scenes: true,
            camera: true,
          },
          inspection: {
            semanticProjectIndex: true,
            revisionBoundPagination: true,
          },
          export: {
            animatedExcalidraw: true,
            json: true,
            png: true,
            svg: true,
            webm: 'browser-dependent',
            mp4: 'browser-dependent',
          },
        },
        limits: {
          maxScenesPerStoryboard: 20,
          maxOperationsPerRevision: 100,
          maxInspectionElementsPerPage: 200,
        },
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
        storyboard: storyboardSchema,
        filename: z.string().optional(),
        saveToWorkspace: z.boolean().optional(),
        workspaceId: z.string().optional(),
      },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async ({ storyboard, filename, saveToWorkspace, workspaceId }) => {
      const created = await store.create(storyboard, filename)
      const projectSnapshot = await store.read(created.filename)
      const summary = {
        ...created,
        uiResourceUri: UI_RESOURCE_URI,
        uiResourceAttached: true,
      }
      if (saveToWorkspace) {
        const workspace = workspaceId
          ? { id: workspaceId }
          : await projects.ensureDefaultWorkspace()
        const project = await projects.createProject({
          workspaceId: workspace.id,
          name: storyboard.projectName,
          source: 'mcp',
          label: 'Created by ChatGPT',
          snapshot: projectSnapshot,
          extension: { version: 1, timeline: { version: 2 } },
          assetHashes: [],
        })
        Object.assign(summary, {
          workspaceId: project.workspaceId,
          projectId: project.projectId,
          revision: project.revision.number,
        })
      }
      const identity = summary as typeof summary & {
        projectId?: string
        workspaceId?: string
      }
      const indexIdentity = {
        filename: summary.filename,
        revision: summary.revision,
        ...(identity.projectId ? { projectId: identity.projectId } : {}),
        ...(identity.workspaceId ? { workspaceId: identity.workspaceId } : {}),
      }
      return appProjectResult(summary, projectSnapshot, {
        creationReceipt: buildCreationReceipt(projectSnapshot, indexIdentity),
        projectIndex: buildProjectIndex(projectSnapshot, indexIdentity),
      })
    },
  )

  registerAppTool(
    server,
    'revise_animation',
    {
      description: 'Atomically revise drawing, animation, scene, camera, or durable project state.',
      inputSchema: {
        filename: z.string().optional(),
        projectId: z.string().optional(),
        expectedRevision: z.number().int().positive().optional(),
        operations: z.array(revisionOperationSchema).max(100).optional(),
        projectAction: projectActionSchema.optional(),
      },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async ({ filename, projectId, expectedRevision, operations = [], projectAction }) => {
      if (filename && projectId) throw new Error('filename and projectId are mutually exclusive.')
      if (projectAction && operations.length) throw new Error('projectAction and operations are mutually exclusive.')
      if (projectAction && !projectId) throw new Error('projectAction requires projectId.')
      if (projectAction && expectedRevision !== undefined) throw new Error('expectedRevision is not supported with projectAction.')
      if (!projectId && expectedRevision !== undefined) throw new Error('expectedRevision requires projectId.')

      if (projectId) {
        const before = await projects.getProject(projectId, { includeTrashed: true })
        let project
        if (projectAction?.action === 'rename') {
          project = await projects.renameProject(projectId, projectAction.name ?? '')
        } else if (projectAction?.action === 'duplicate') {
          project = await projects.duplicateProject(projectId, {
            name: projectAction.name ?? '',
            targetWorkspaceId: projectAction.targetWorkspaceId,
          })
        } else if (projectAction?.action === 'trash') {
          project = await projects.trashProject(projectId)
        } else if (projectAction?.action === 'restore') {
          project = await projects.restoreProject(projectId)
        } else if (projectAction?.action === 'restore-revision') {
          project = await projects.restoreRevision(projectId, projectAction.revision)
        } else if (projectAction) {
          throw new Error(`Unsupported project action: ${String(projectAction.action)}`)
        } else {
          if (expectedRevision === undefined) throw new Error('expectedRevision requires projectId revisions.')
          const snapshot = applyRevisionOperations(
            before.snapshot as ExcalidrawDocument,
            operations,
          )
          project = await projects.updateProject(projectId, {
            expectedRevision,
            source: 'mcp',
            label: 'Revised by ChatGPT',
            snapshot,
            extension: before.extension,
            assetHashes: before.assetHashes,
          })
        }
        const snapshot = project.snapshot as ExcalidrawDocument
        const summary = {
          status: 'revised',
          workspaceId: project.workspaceId,
          projectId: project.projectId,
          ...summarizeAnimationDocument(
            `${project.name}.excalidraw`,
            snapshot,
            project.revision.number,
          ),
          operationsApplied: projectAction ? 0 : operations.length,
          uiResourceUri: UI_RESOURCE_URI,
          uiResourceAttached: true,
        }
        const additions = projectAction
          ? {
              projectActionReceipt: buildProjectActionReceipt(
                before.snapshot as ExcalidrawDocument,
                snapshot,
                {
                  action: projectAction.action,
                  ...(projectAction.action === 'restore-revision'
                    ? { sourceRevision: projectAction.revision }
                    : {}),
                  sourceProjectId: before.projectId,
                  filename: summary.filename,
                  name: project.name,
                  projectId: project.projectId,
                  workspaceId: project.workspaceId,
                  previousRevision: before.revision.number,
                  revision: project.revision.number,
                },
              ),
            }
          : {
              mutationReceipt: buildMutationReceipt(
                before.snapshot as ExcalidrawDocument,
                snapshot,
                operations.length,
                {
                  filename: summary.filename,
                  name: project.name,
                  projectId: project.projectId,
                  workspaceId: project.workspaceId,
                  previousRevision: before.revision.number,
                  revision: project.revision.number,
                },
              ),
            }
        return appProjectResult(summary, snapshot, additions)
      }

      if (!filename) throw new Error('filename or projectId is required.')
      const before = await store.read(filename)
      const previousRevision = summarizeAnimationDocument(filename, before).revision
      await store.revise(filename, operations)
      const snapshot = await store.read(filename)
      const revised = summarizeAnimationDocument(filename, snapshot, previousRevision + 1)
      return appProjectResult({
        status: 'revised',
        ...revised,
        operationsApplied: operations.length,
        uiResourceUri: UI_RESOURCE_URI,
        uiResourceAttached: true,
      }, snapshot, {
        mutationReceipt: buildMutationReceipt(before, snapshot, operations.length, {
          filename,
          previousRevision,
          revision: revised.revision,
        }),
      })
    },
  )

  server.registerTool(
    'validate_animation',
    {
      description: 'Validate an exact generated file or durable project revision.',
      inputSchema: {
        filename: z.string().optional(),
        projectId: z.string().optional(),
        revision: z.number().int().positive().optional(),
      },
    },
    async ({ filename, projectId, revision }) => {
      const snapshot = projectId
        ? (await projects.getProject(projectId, { revision })).snapshot as ExcalidrawDocument
        : filename
          ? await store.read(filename)
          : undefined
      if (!snapshot) throw new Error('filename or projectId is required.')
      return jsonResult(validateAnimationDocument(snapshot))
    },
  )

  server.registerTool(
    'list_animations',
    {
      description: 'Find generated files and durable projects by workspace or name.',
      inputSchema: {
        workspaceId: z.string().optional(),
        query: z.string().optional(),
        includeTrashed: z.boolean().optional(),
      },
    },
    async ({ workspaceId, query, includeTrashed }) => {
      const workspaces = await projects.listWorkspaces()
      const available = workspaces.length ? workspaces : [await projects.ensureDefaultWorkspace()]
      const selectedWorkspaceId = workspaceId ?? available[0]!.id
      const durableProjects = (await projects.listProjects({
        workspaceId: selectedWorkspaceId,
        query,
        includeTrashed,
      })).map((project) => ({
        ...project,
        revision: project.currentRevision,
        trashed: project.trash.state === 'trashed',
        thumbnailAvailable: false,
      }))
      return jsonResult({
        filenames: await store.list(),
        workspaces: available,
        projects: durableProjects,
      })
    },
  )

  registerAppTool(
    server,
    'open_animation_studio',
    {
      description: 'Open one existing animation in the embedded editor and player.',
      inputSchema: {
        filename: z.string().optional(),
        projectId: z.string().optional(),
        revision: z.number().int().positive().optional(),
        ...projectInspectionShape,
      },
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async ({
      filename,
      projectId,
      revision,
      sceneId,
      elementIds,
      query,
      elementType,
      animationOnly,
      limit,
      cursor,
    }) => {
      const durable = projectId
        ? await projects.getProject(projectId, { revision })
        : undefined
      if (!filename && !durable) throw new Error('filename or projectId is required.')
      const projectSnapshot = durable
        ? durable.snapshot as ExcalidrawDocument
        : await store.read(filename!)
      const validation = validateAnimationDocument(projectSnapshot)
      if (!validation.valid) throw new Error(validation.errors.join(' '))
      const summary = {
        status: 'opened',
        ...(durable ? { workspaceId: durable.workspaceId, projectId: durable.projectId } : {}),
        ...summarizeAnimationDocument(
          durable ? `${durable.name}.excalidraw` : filename!,
          projectSnapshot,
          durable?.revision.number ?? 1,
        ),
        validationStatus: 'valid',
        uiResourceUri: UI_RESOURCE_URI,
        uiResourceAttached: true,
      }
      const projectIndex = buildProjectIndex(
        projectSnapshot,
        {
          filename: summary.filename,
          revision: summary.revision,
          ...(durable
            ? {
                name: durable.name,
                projectId: durable.projectId,
                workspaceId: durable.workspaceId,
              }
            : {}),
        },
        { sceneId, elementIds, query, elementType, animationOnly, limit, cursor },
      )
      return appProjectResult(summary, projectSnapshot, { projectIndex })
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
