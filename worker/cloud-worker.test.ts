import { describe, expect, it } from 'vitest'

import { createCloudWorker, type CloudWorkerEnv } from './cloud-worker.ts'
import type { R2BucketLike } from '../mcp/cloud-storage.ts'

class MemoryBucket implements R2BucketLike {
  async get() {
    return null
  }

  async put() {
    return { etag: 'test' }
  }

  async list() {
    return { objects: [], truncated: false }
  }
}

const secret = 's'.repeat(43)
const context = () => ({ waitUntil() {} })
const environment = (overrides: Partial<CloudWorkerEnv> = {}): CloudWorkerEnv => ({
  ANIMATION_MCP_SECRET: secret,
  ANIMATIONS: new MemoryBucket(),
  ...overrides,
})

const worker = createCloudWorker({
  fallbackFetch: async () => new Response('site', { status: 299 }),
})

describe('Sites cloud worker routing', () => {
  it('serves health while delegating normal site requests', async () => {
    const health = await worker.fetch(
      new Request('https://animation.example.com/health'),
      environment(),
      context(),
    )
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toMatchObject({
      status: 'ok',
      runtime: 'cloudflare-worker',
    })

    const site = await worker.fetch(
      new Request('https://animation.example.com/'),
      environment(),
      context(),
    )
    expect(site.status).toBe(299)
    await expect(site.text()).resolves.toBe('site')
  })

  it('adds cross-origin headers to hosted MCP App assets', async () => {
    const assetWorker = createCloudWorker({
      fallbackFetch: async (request) =>
        new Response(new URL(request.url).pathname, {
          headers: { 'content-type': 'text/javascript' },
        }),
    })

    for (const [path, sourcePath] of [
      ['/mcp-app/animation-studio.js', '/mcp-app-assets/animation-studio.js'],
      ['/mcp-app/animation-studio.css', '/mcp-app-assets/animation-studio.css'],
    ]) {
      const response = await assetWorker.fetch(
        new Request(`https://animation.example.com${path}`),
        environment(),
        context(),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('cross-origin-resource-policy')).toBe(
        'cross-origin',
      )
      await expect(response.text()).resolves.toBe(sourcePath)
    }
  })

  it('fails closed when the hosted MCP secret is missing or invalid', async () => {
    const response = await worker.fetch(
      new Request('https://animation.example.com/mcp/anything/', {
        method: 'POST',
      }),
      environment({ ANIMATION_MCP_SECRET: '' }),
      context(),
    )

    expect(response.status).toBe(503)
  })

  it('hides incorrect MCP routes and accepts the configured secret route', async () => {
    const incorrect = await worker.fetch(
      new Request('https://animation.example.com/mcp/wrong/', {
        method: 'POST',
      }),
      environment(),
      context(),
    )
    expect(incorrect.status).toBe(404)

    const correct = await worker.fetch(
      new Request(`https://animation.example.com/mcp/${secret}/`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          Origin: 'https://chatgpt.com',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'worker-test', version: '1.0.0' },
          },
        }),
      }),
      environment(),
      context(),
    )

    expect(correct.status).toBe(200)
    await expect(correct.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: { name: 'sanverse-excalidraw-animation-cloud' },
      },
    })
  })
})
