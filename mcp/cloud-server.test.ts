import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'

import { handleCloudMcpRequest } from './cloud-server.ts'
import type { R2BucketLike } from './cloud-storage.ts'

const UI_RESOURCE_URI = 'ui://sanverse/animation-studio-v4.html'
const PUBLIC_ORIGIN = 'https://sanverse-animation.example.com'

class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, { value: string; etag: string }>()
  private revision = 0

  async get(key: string) {
    const object = this.objects.get(key)
    return object === undefined
      ? null
      : { etag: object.etag, text: async () => object.value }
  }

  async put(
    key: string,
    value: string,
    options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } },
  ) {
    const current = this.objects.get(key)
    if (options?.onlyIf?.etagMatches !== undefined && current?.etag !== options.onlyIf.etagMatches) return null
    if (options?.onlyIf?.etagDoesNotMatch === '*' && current) return null
    const object = { value, etag: `etag-${++this.revision}` }
    this.objects.set(key, object)
    return { etag: object.etag }
  }

  async list(options?: { prefix?: string }) {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(options?.prefix ?? ''))
        .sort()
        .map((key) => ({ key })),
      truncated: false,
    }
  }
}

const storyboard = {
  projectName: 'Cloud MCP demo',
  scenes: [
    {
      sceneId: 'scene-1',
      title: 'Cloud',
      elements: [
        {
          id: 'shape',
          type: 'rectangle',
          x: 160,
          y: 180,
          width: 320,
          height: 180,
          text: 'Online',
          animation: { step: 1, effect: 'pop' },
        },
      ],
    },
  ],
} as const

const clients: Client[] = []

const textResult = (result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse(String((result.content as Array<{ text?: string }>)[0]?.text)) as
    Record<string, any>

afterEach(async () => {
  while (clients.length) await clients.pop()?.close()
})

const connectClient = async (bucket: R2BucketLike) => {
  const client = new Client({ name: 'cloud-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL(`${PUBLIC_ORIGIN}/mcp/testing/`),
    {
      requestInit: { headers: { Origin: 'https://chatgpt.com' } },
      fetch: async (input, init) =>
        handleCloudMcpRequest(new Request(input, init), {
          bucket,
          publicOrigin: PUBLIC_ORIGIN,
        }),
    },
  )
  await client.connect(transport)
  clients.push(client)
  return client
}

describe('cloud animation MCP', () => {
  it('exposes the MCP App and persists created projects in R2', async () => {
    const bucket = new MemoryBucket()
    const client = await connectClient(bucket)

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'get_animation_status',
      'create_animation',
      'revise_animation',
      'validate_animation',
      'list_animations',
      'open_animation_studio',
    ])

    const resources = await client.listResources()
    expect(resources.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: UI_RESOURCE_URI,
          _meta: {
            ui: {
              csp: {
                resourceDomains: [PUBLIC_ORIGIN],
                connectDomains: ['https://api.iconify.design'],
              },
            },
          },
        }),
      ]),
    )
    const resource = await client.readResource({ uri: UI_RESOURCE_URI })
    const content = resource.contents[0]
    expect(content).toMatchObject({
      uri: UI_RESOURCE_URI,
      mimeType: 'text/html;profile=mcp-app',
      _meta: {
        ui: {
          csp: {
            resourceDomains: [PUBLIC_ORIGIN],
            connectDomains: ['https://api.iconify.design'],
          },
        },
      },
    })
    const html = 'text' in content ? content.text : ''
    expect(html).toContain(`${PUBLIC_ORIGIN}/mcp-app/animation-studio.js`)
    expect(html).toContain(`${PUBLIC_ORIGIN}/mcp-app/animation-studio.css`)

    const created = await client.callTool({
      name: 'create_animation',
      arguments: { storyboard, filename: 'online.excalidraw' },
    })
    expect(created.structuredContent).toMatchObject({
      status: 'created',
      filename: 'online.excalidraw',
      revision: 1,
      uiResourceUri: UI_RESOURCE_URI,
      uiResourceAttached: true,
    })
    expect(bucket.objects.has('online.excalidraw')).toBe(true)

    const opened = await client.callTool({
      name: 'open_animation_studio',
      arguments: { filename: 'online.excalidraw' },
    })
    expect(opened._meta).toMatchObject({
      filename: 'online.excalidraw',
      revision: 1,
      uiResourceUri: UI_RESOURCE_URI,
    })
  })

  it('matches the current durable project, inspection, and revision contracts', async () => {
    const bucket = new MemoryBucket()
    const client = await connectClient(bucket)
    const tools = await client.listTools()
    const createTool = tools.tools.find(({ name }) => name === 'create_animation')
    const reviseTool = tools.tools.find(({ name }) => name === 'revise_animation')
    expect(createTool?.inputSchema.properties).toMatchObject({
      saveToWorkspace: { type: 'boolean' },
      workspaceId: { type: 'string' },
    })
    const advertisedOperations = JSON.stringify(
      reviseTool?.inputSchema.properties?.operations,
    )
    for (const operation of [
      'add_element',
      'change_text',
      'set_animation_step',
      'set_animation_effect',
      'set_animation_timing',
      'set_animation_group',
      'clear_animation',
      'set_scene',
      'set_camera_track',
      'move_element',
      'update_element',
      'duplicate_element',
      'delete_element',
      'reorder_element',
      'set_bindings',
      'set_excalidraw_groups',
    ]) expect(advertisedOperations).toContain(`"${operation}"`)

    const status = await client.callTool({
      name: 'get_animation_status',
      arguments: {},
    })
    expect(textResult(status)).toMatchObject({
      durableProjects: true,
      optimisticRevisionControl: true,
      capabilities: {
        persistence: { workspaces: true, revisionHistory: true },
        inspection: { semanticProjectIndex: true },
      },
      limits: { maxOperationsPerRevision: 100 },
    })

    const created = await client.callTool({
      name: 'create_animation',
      arguments: {
        storyboard,
        filename: 'durable-online.excalidraw',
        saveToWorkspace: true,
      },
    })
    expect(created.structuredContent).toMatchObject({
      projectId: expect.stringMatching(/^prj_/),
      workspaceId: expect.stringMatching(/^ws_/),
      creationReceipt: { revision: 1 },
      projectIndex: { schemaVersion: 1 },
    })
    const projectId = String(
      (created.structuredContent as Record<string, unknown>).projectId,
    )

    const revised = await client.callTool({
      name: 'revise_animation',
      arguments: {
        projectId,
        expectedRevision: 1,
        operations: [{ type: 'move_element', elementId: 'shape', x: 700, y: 420 }],
      },
    })
    expect(revised.structuredContent).toMatchObject({
      projectId,
      revision: 2,
      mutationReceipt: {
        previousRevision: 1,
        revision: 2,
        updatedElementIds: ['shape'],
      },
    })

    const inspected = await client.callTool({
      name: 'open_animation_studio',
      arguments: { projectId, revision: 2, elementIds: ['shape'] },
    })
    expect(inspected.structuredContent).toMatchObject({
      projectId,
      revision: 2,
      projectIndex: {
        elements: [expect.objectContaining({ id: 'shape', x: 700, y: 420 })],
      },
    })

    const validation = await client.callTool({
      name: 'validate_animation',
      arguments: { projectId, revision: 2 },
    })
    expect(textResult(validation)).toMatchObject({ valid: true })

    const listed = await client.callTool({
      name: 'list_animations',
      arguments: { query: 'Cloud MCP' },
    })
    expect(textResult(listed)).toMatchObject({
      workspaces: [expect.objectContaining({ id: expect.stringMatching(/^ws_/) })],
      projects: [expect.objectContaining({ projectId, revision: 2 })],
    })

    const renamed = await client.callTool({
      name: 'revise_animation',
      arguments: {
        projectId,
        projectAction: { action: 'rename', name: 'Renamed online' },
      },
    })
    expect(renamed.structuredContent).toMatchObject({
      projectId,
      filename: 'Renamed online.excalidraw',
      projectActionReceipt: { action: 'rename' },
    })
  })

  it('rejects non-ChatGPT browser origins', async () => {
    const response = await handleCloudMcpRequest(
      new Request(`${PUBLIC_ORIGIN}/mcp/testing/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://example.com',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'blocked', version: '1.0.0' },
          },
        }),
      }),
      { bucket: new MemoryBucket(), publicOrigin: PUBLIC_ORIGIN },
    )

    expect(response.status).toBe(403)
  })
})
