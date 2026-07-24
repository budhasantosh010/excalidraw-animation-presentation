import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'

import { createAnimationFile } from './animation-tools.ts'
import { startAnimationMcpServer } from './server.ts'

const cleanup: Array<() => Promise<void>> = []
const UI_RESOURCE_URI = 'ui://sanverse/animation-studio-v4.html'
const PUBLIC_ORIGIN = 'https://desktop-fdce9ak.taila47816.ts.net'

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.()
})

const storyboard = {
  projectName: 'Lean MCP Demo',
  scenes: [
    {
      sceneId: 'scene-1',
      title: 'Agent Workflow',
      elements: [
        {
          id: 'input',
          type: 'rectangle',
          x: 120,
          y: 220,
          width: 280,
          height: 140,
          text: 'Input',
          animation: { step: 1, effect: 'pop' },
        },
        {
          id: 'output',
          type: 'rectangle',
          x: 760,
          y: 220,
          width: 280,
          height: 140,
          text: 'Output',
          animation: { step: 3, effect: 'fade' },
        },
        {
          id: 'flow',
          type: 'arrow',
          x: 400,
          y: 290,
          width: 360,
          height: 0,
          startElementId: 'input',
          endElementId: 'output',
          animation: { step: 2, effect: 'draw' },
        },
      ],
    },
  ],
} as const

const textResult = (result: unknown) => {
  const candidate = result as {
    content?: Array<{ type: string; text?: string }>
  }
  return JSON.parse(candidate.content?.[0]?.text ?? '{}') as Record<
    string,
    unknown
  >
}

const requestHealthWithHost = (port: number, host: string) =>
  new Promise<number>((resolve, reject) => {
    const healthRequest = request(
      {
        host: '127.0.0.1',
        port,
        path: '/health',
        headers: { Host: host },
      },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      },
    )
    healthRequest.once('error', reject)
    healthRequest.end()
  })

const requestAsset = (port: number, assetUrl: string) =>
  new Promise<{
    status: number
    headers: Record<string, string | string[] | undefined>
    body: Buffer
  }>((resolve, reject) => {
    const url = new URL(assetUrl)
    const assetRequest = request(
      {
        host: '127.0.0.1',
        port,
        path: `${url.pathname}${url.search}`,
        headers: { Host: url.host },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    assetRequest.once('error', reject)
    assetRequest.end()
  })

const startOriginTestServer = async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'animation-mcp-origin-'))
  const secret = 'o'.repeat(43)
  const running = await startAnimationMcpServer({
    host: '127.0.0.1',
    port: 0,
    routeSecret: secret,
    outputDir,
    allowedHosts: ['127.0.0.1', 'localhost'],
    publicOrigin: PUBLIC_ORIGIN,
  })
  cleanup.push(async () => {
    await running.close()
    await rm(outputDir, { recursive: true, force: true })
  })
  return { port: running.port, secret }
}

describe('lean animation MCP', () => {
  it.each([
    ['missing Origin', undefined],
    ['ChatGPT Origin', 'https://chatgpt.com'],
    ['legacy ChatGPT Origin', 'https://chat.openai.com'],
  ])('allows %s', async (_label, origin) => {
    const { port, secret } = await startOriginTestServer()
    const client = new Client({ name: 'origin-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp/${secret}/`),
      origin
        ? { requestInit: { headers: { Origin: origin } } }
        : undefined,
    )
    await client.connect(transport)
    cleanup.push(() => client.close())

    const tools = await client.listTools()
    expect(tools.tools).toHaveLength(6)
  })

  it('rejects any other present Origin', async () => {
    const { port, secret } = await startOriginTestServer()
    const client = new Client({ name: 'origin-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp/${secret}/`),
      {
        requestInit: {
          headers: { Origin: 'https://example.com' },
        },
      },
    )

    await expect(client.connect(transport)).rejects.toThrow(/403|Forbidden/)
  })

  it('initializes, exposes the UI resource, and hands the exact project to create/open', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'animation-mcp-'))
    const secret = 's'.repeat(43)
    const running = await startAnimationMcpServer({
      host: '127.0.0.1',
      port: 0,
      routeSecret: secret,
      outputDir,
      allowedHosts: [
        '127.0.0.1',
        'localhost',
        'desktop-fdce9ak.taila47816.ts.net',
      ],
      publicOrigin: PUBLIC_ORIGIN,
    })
    cleanup.push(async () => {
      await running.close()
      await rm(outputDir, { recursive: true, force: true })
    })

    const client = new Client({ name: 'lean-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${running.port}/mcp/${secret}/`),
      { requestInit: { headers: { Origin: 'https://chatgpt.com' } } },
    )
    await client.connect(transport)
    cleanup.push(() => client.close())

    const publicHealthStatus = await requestHealthWithHost(
      running.port,
      'desktop-fdce9ak.taila47816.ts.net',
    )
    expect(publicHealthStatus).toBe(200)

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'get_animation_status',
      'create_animation',
      'revise_animation',
      'validate_animation',
      'list_animations',
      'open_animation_studio',
    ])
    for (const name of ['create_animation', 'open_animation_studio']) {
      expect(tools.tools.find((tool) => tool.name === name)?._meta).toMatchObject(
        {
          ui: { resourceUri: UI_RESOURCE_URI },
        },
      )
    }

    const resources = await client.listResources()
    expect(resources.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uri: UI_RESOURCE_URI }),
      ]),
    )
    const resource = await client.readResource({ uri: UI_RESOURCE_URI })
    const resourceContent = resource.contents[0]
    expect(resourceContent).toMatchObject({
      uri: UI_RESOURCE_URI,
      mimeType: 'text/html;profile=mcp-app',
      _meta: {
        ui: {
          csp: {
            resourceDomains: [PUBLIC_ORIGIN],
          },
        },
      },
    })
    const resourceHtml =
      'text' in resourceContent ? resourceContent.text : ''
    expect(Buffer.byteLength(resourceHtml, 'utf8')).toBeLessThan(20_000)
    expect(resourceHtml).toContain('Sanverse Animation Studio')
    expect(resourceHtml).toContain('id="root"')
    expect(resourceHtml).toContain('Animation Studio failed to load')
    expect(resourceHtml).not.toContain('Animation Studio connection proof')

    const scriptUrl = resourceHtml.match(
      /<script[^>]+src="(?<url>https:[^"]+\.js)"/,
    )?.groups?.url
    const styleUrl = resourceHtml.match(
      /<link[^>]+href="(?<url>https:[^"]+\.css)"/,
    )?.groups?.url
    expect(scriptUrl).toMatch(
      /^https:\/\/desktop-fdce9ak\.taila47816\.ts\.net\/mcp-app-assets\/[a-f0-9]{16}\/assets\/.+-[A-Za-z0-9_-]+\.js$/,
    )
    expect(styleUrl).toMatch(
      /^https:\/\/desktop-fdce9ak\.taila47816\.ts\.net\/mcp-app-assets\/[a-f0-9]{16}\/assets\/.+-[A-Za-z0-9_-]+\.css$/,
    )

    const [scriptAsset, styleAsset] = await Promise.all([
      requestAsset(running.port, scriptUrl ?? ''),
      requestAsset(running.port, styleUrl ?? ''),
    ])
    expect(scriptAsset.status).toBe(200)
    expect(scriptAsset.headers['content-type']).toMatch(/javascript/)
    expect(scriptAsset.headers['access-control-allow-origin']).toBe('*')
    expect(scriptAsset.headers['cache-control']).toMatch(/immutable/)
    expect(scriptAsset.body.length).toBeGreaterThan(100_000)
    expect(styleAsset.status).toBe(200)
    expect(styleAsset.headers['content-type']).toMatch(/text\/css/)
    expect(styleAsset.headers['access-control-allow-origin']).toBe('*')
    expect(styleAsset.headers['cache-control']).toMatch(/immutable/)
    expect(styleAsset.body.length).toBeGreaterThan(10_000)

    const status = textResult(
      await client.callTool({
        name: 'get_animation_status',
        arguments: {},
      }),
    )
    expect(status).toMatchObject({ status: 'ok', port: running.port })

    const createResult = await client.callTool({
        name: 'create_animation',
        arguments: { storyboard },
      })
    const created = textResult(createResult)
    const filename = String(created.filename)
    const document = JSON.parse(
      await readFile(join(outputDir, filename), 'utf8'),
    ) as {
      elements: Array<Record<string, any>>
    }
    const byId = Object.fromEntries(
      document.elements.map((element) => [element.id, element]),
    )

    expect(created).toMatchObject({
      status: 'created',
      revision: 1,
      sceneCount: 1,
      drawableElementCount: 5,
      animatedElementCount: 5,
      stepCount: 3,
      validationStatus: 'valid',
      uiResourceUri: UI_RESOURCE_URI,
      uiResourceAttached: true,
    })
    expect(createResult.structuredContent).toMatchObject(created)
    expect(createResult._meta).toMatchObject({
      filename,
      revision: 1,
      uiResourceUri: UI_RESOURCE_URI,
      projectSnapshot: document,
    })

    const openResult = await client.callTool({
      name: 'open_animation_studio',
      arguments: { filename },
    })
    expect(textResult(openResult)).toMatchObject({
      filename,
      revision: 1,
      drawableElementCount: 5,
      animatedElementCount: 5,
      stepCount: 3,
      uiResourceUri: UI_RESOURCE_URI,
      uiResourceAttached: true,
    })
    expect(openResult._meta).toMatchObject({
      filename,
      revision: 1,
      uiResourceUri: UI_RESOURCE_URI,
      projectSnapshot: document,
    })
    expect(byId.input.customData.sanverseAnimation).toMatchObject({
      version: 1,
      step: 1,
      effect: 'pop',
    })
    expect(byId.flow.customData.sanverseAnimation.step).toBe(2)
    expect(byId.flow.customData.sanverseAnimation.effect).toBe('draw')
    expect(byId.output.customData.sanverseAnimation.step).toBe(3)
    expect(byId.output.customData.sanverseAnimation.effect).toBe('fade')
  })

  it('rejects output path traversal', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'animation-mcp-path-'))
    cleanup.push(() => rm(outputDir, { recursive: true, force: true }))

    await expect(
      createAnimationFile(outputDir, storyboard, '../escape.excalidraw'),
    ).rejects.toThrow(/filename/i)
  })

  it('rejects a storyboard with no drawable elements', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'animation-mcp-empty-'))
    cleanup.push(() => rm(outputDir, { recursive: true, force: true }))

    await expect(
      createAnimationFile(outputDir, {
        projectName: 'Empty',
        scenes: [{ sceneId: 'scene-1', title: 'Empty', elements: [] }],
      }),
    ).rejects.toThrow(/drawable element/i)
  })
})
