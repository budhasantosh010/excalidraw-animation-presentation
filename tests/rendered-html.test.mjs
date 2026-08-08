import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const environment = {
  ANIMATION_MCP_SECRET: 's'.repeat(43),
  ANIMATIONS: {
    async get() {
      return null
    },
    async put() {
      return { etag: 'test' }
    },
    async list() {
      return { objects: [], truncated: false }
    },
  },
  ASSETS: {
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const asset = pathname.startsWith('/mcp-app-assets/')
        ? new URL(`../dist/client${pathname}`, import.meta.url)
        : null
      if (!asset) return new Response('Not found', { status: 404 })
      try {
        const body = await readFile(asset)
        const contentType = pathname.endsWith('.css')
          ? 'text/css'
          : 'text/javascript'
        return new Response(body, { headers: { 'content-type': contentType } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    },
  },
}

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url)
  workerUrl.searchParams.set('test', `${process.pid}-${Date.now()}`)
  return (await import(workerUrl.href)).default
}

test('server-renders the hosted Sanverse animation studio shell', async () => {
  const worker = await loadWorker()
  const response = await worker.fetch(
    new Request('https://animation.example.com/', {
      headers: {
        accept: 'text/html',
        host: 'animation.example.com',
        'x-forwarded-proto': 'https',
      },
    }),
    environment,
    { waitUntil() {}, passThroughOnException() {} },
  )

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i)

  const html = await response.text()
  assert.match(html, /<title>Sanverse Animated Excalidraw<\/title>/i)
  assert.match(html, /Loading Sanverse Animation Studio/i)
  assert.match(
    html,
    /<meta[^>]+property="og:image"[^>]+content="https:\/\/animation\.example\.com\/og\.png"/i,
  )
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i)
})

test('packages the Sites R2 binding with the worker build', async () => {
  const hosting = JSON.parse(
    await readFile(new URL('../dist/.openai/hosting.json', import.meta.url), 'utf8'),
  )

  assert.equal(hosting.r2, 'ANIMATIONS')
  assert.equal(hosting.d1, null)
  assert.equal(hosting.project_id, 'appgprj_6a76585590c0819181c9a5a7eb5c56a2')
})

test('packages the ChatGPT MCP App assets with the hosted build', async () => {
  await Promise.all([
    access(new URL('../dist/client/mcp-app-assets/animation-studio.js', import.meta.url)),
    access(new URL('../dist/client/mcp-app-assets/animation-studio.css', import.meta.url)),
  ])
})

test('worker build exposes public health', async () => {
  const worker = await loadWorker()
  const response = await worker.fetch(
    new Request('https://animation.example.com/health'),
    environment,
    { waitUntil() {}, passThroughOnException() {} },
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: 'ok',
    app: 'Sanverse Excalidraw Animation',
    runtime: 'cloudflare-worker',
  })
})

test('worker build serves cross-origin MCP App assets', async () => {
  const worker = await loadWorker()
  for (const [path, contentType] of [
    ['/mcp-app-assets/animation-studio.js', 'text/javascript'],
    ['/mcp-app-assets/animation-studio.css', 'text/css'],
  ]) {
    const response = await worker.fetch(
      new Request(`https://animation.example.com${path}`),
      environment,
      { waitUntil() {}, passThroughOnException() {} },
    )

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', new RegExp(contentType))
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin')
  }
})
