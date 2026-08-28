import { handleCloudMcpRequest } from '../mcp/cloud-server.ts'
import type { R2BucketLike } from '../mcp/cloud-storage.ts'
import type { ExecutionContextLike } from 'vinext/shims/request-context'

export type CloudWorkerEnv = {
  ANIMATION_MCP_SECRET: string
  ANIMATIONS: R2BucketLike
  ASSETS?: {
    fetch(request: Request): Promise<Response> | Response
  }
}

type WorkerContext = ExecutionContextLike

type CloudWorkerDependencies = {
  fallbackFetch(
    request: Request,
    env: CloudWorkerEnv,
    context: WorkerContext,
  ): Promise<Response>
}

const validSecret = (value: string) => /^[A-Za-z0-9_-]{43,}$/.test(value)

export const createCloudWorker = ({
  fallbackFetch,
}: CloudWorkerDependencies) => ({
  async fetch(
    request: Request,
    env: CloudWorkerEnv,
    context: WorkerContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        app: 'Sanverse Excalidraw Animation',
        runtime: 'cloudflare-worker',
      })
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return Response.json(
        { error: 'Online workspaces are stored in the browser, not a public server API.' },
        { status: 404 },
      )
    }

    if (url.pathname.startsWith('/mcp/')) {
      if (!validSecret(env.ANIMATION_MCP_SECRET ?? '')) {
        return Response.json(
          { error: 'Hosted MCP is not configured.' },
          { status: 503 },
        )
      }
      if (url.pathname !== `/mcp/${env.ANIMATION_MCP_SECRET}/`) {
        return new Response('Not Found', { status: 404 })
      }
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'POST' },
        })
      }
      try {
        return await handleCloudMcpRequest(request, {
          bucket: env.ANIMATIONS,
          publicOrigin: url.origin,
        })
      } catch {
        return Response.json(
          {
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          },
          { status: 500 },
        )
      }
    }

    if (url.pathname.startsWith('/mcp-app/')) {
      const assetUrl = new URL(request.url)
      assetUrl.pathname = url.pathname.replace(
        '/mcp-app/',
        '/mcp-app-assets/',
      )
      const assetRequest = new Request(assetUrl, request)
      const response = await fallbackFetch(assetRequest, env, context)
      const headers = new Headers(response.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
      if (url.pathname.endsWith('.woff2')) {
        headers.set('Content-Type', 'font/woff2')
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    return fallbackFetch(request, env, context)
  },
})
