import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'

import { handleCloudMcpRequest } from './cloud-server.ts'
import type { R2BucketLike } from './cloud-storage.ts'

const UI_RESOURCE_URI = 'ui://sanverse/animation-studio-v4.html'
const PUBLIC_ORIGIN = 'https://sanverse-animation.example.com'

class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, string>()

  async get(key: string) {
    const value = this.objects.get(key)
    return value === undefined
      ? null
      : { etag: `etag-${key}`, text: async () => value }
  }

  async put(key: string, value: string) {
    this.objects.set(key, value)
    return { etag: `etag-${key}` }
  }

  async list() {
    return {
      objects: [...this.objects.keys()].sort().map((key) => ({ key })),
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
    expect(html).toContain(`${PUBLIC_ORIGIN}/mcp-app-assets/animation-studio.js`)
    expect(html).toContain(`${PUBLIC_ORIGIN}/mcp-app-assets/animation-studio.css`)

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
