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

const startOriginTestServer = async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'animation-mcp-origin-'))
  const secret = 'o'.repeat(43)
  const running = await startAnimationMcpServer({
    host: '127.0.0.1',
    port: 0,
    routeSecret: secret,
    outputDir,
    allowedHosts: ['127.0.0.1', 'localhost'],
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
    expect(tools.tools).toHaveLength(5)
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

  it('initializes, lists five tools, reports status, and creates an animation', async () => {
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
    ])

    const status = textResult(
      await client.callTool({
        name: 'get_animation_status',
        arguments: {},
      }),
    )
    expect(status).toMatchObject({ status: 'ok', port: running.port })

    const created = textResult(
      await client.callTool({
        name: 'create_animation',
        arguments: { storyboard },
      }),
    )
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
      sceneCount: 1,
      validationStatus: 'valid',
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
})
