import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const UI_RESOURCE_URI =
  'ui://sanverse/animation-studio-v4.html'

export const UI_DIST_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../dist-mcp-app',
)

const UI_MANIFEST_PATH = resolve(UI_DIST_DIR, '.vite/manifest.json')

type ViteManifestEntry = {
  file?: unknown
  css?: unknown
}

export type McpAppBuild = {
  assetBasePath: string
  bootstrapHtml: string
  publicOrigin: string
  scriptPath: string
  stylePaths: string[]
}

const normalizePublicOrigin = (value: string) => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('MCP_PUBLIC_ORIGIN must be a valid HTTPS origin.')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('MCP_PUBLIC_ORIGIN must be an HTTPS origin without a path.')
  }
  return url.origin
}

const assertAssetPath = async (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !/^assets\/[A-Za-z0-9._/-]+$/.test(value) ||
    value.includes('..')
  ) {
    throw new Error('The MCP App build manifest contains an invalid asset path.')
  }
  const assetStat = await stat(resolve(UI_DIST_DIR, value))
  if (!assetStat.isFile()) {
    throw new Error(`MCP App asset is missing: ${value}`)
  }
  return value
}

const escapeHtmlAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const createBootstrapHtml = (scriptUrl: string, styleUrls: string[]) => {
  const styles = styleUrls
    .map(
      (styleUrl) =>
        `    <link rel="stylesheet" href="${escapeHtmlAttribute(styleUrl)}" onerror="window.__SANVERSE_ASSET_FAILURE__()">`,
    )
    .join('\n')

  return `<!doctype html>
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
${styles}
  </head>
  <body>
    <div id="root">
      <main role="status" style="padding:24px;font-family:system-ui">
        <h1>Sanverse Animation Studio</h1>
        <p>Loading the editor and project...</p>
      </main>
    </div>
    <aside id="asset-load-error" role="alert" hidden
      style="position:fixed;inset:0;z-index:9999;padding:24px;background:Canvas;color:CanvasText;font-family:system-ui">
      <h1>Animation Studio failed to load</h1>
      <p>The production asset bundle could not be loaded. Refresh the ChatGPT app after the MCP server is healthy.</p>
    </aside>
    <script type="module" src="${escapeHtmlAttribute(scriptUrl)}"
      onerror="window.__SANVERSE_ASSET_FAILURE__()"></script>
  </body>
</html>`
}

export const loadMcpAppBuild = async (
  configuredPublicOrigin: string,
): Promise<McpAppBuild> => {
  const publicOrigin = normalizePublicOrigin(configuredPublicOrigin)
  const manifestText = await readFile(UI_MANIFEST_PATH, 'utf8')
  const manifest = JSON.parse(manifestText) as Record<
    string,
    ViteManifestEntry
  >
  const entry = manifest['mcp-app.html']
  if (!entry) throw new Error('The MCP App entry is missing from the manifest.')

  const scriptPath = await assertAssetPath(entry.file)
  const entryCss = Array.isArray(entry.css) ? entry.css : []
  const fallbackCss = Object.values(manifest)
    .map((manifestEntry) => manifestEntry.file)
    .filter(
      (file): file is string =>
        typeof file === 'string' && file.endsWith('.css'),
    )
  const stylePaths = await Promise.all(
    [...new Set([...entryCss, ...fallbackCss])].map(assertAssetPath),
  )
  if (!stylePaths.length) {
    throw new Error('The MCP App stylesheet is missing from the manifest.')
  }

  const buildHash = createHash('sha256')
    .update(manifestText)
    .digest('hex')
    .slice(0, 16)
  const assetBasePath = `/mcp-app-assets/${buildHash}`
  const assetUrl = (assetPath: string) =>
    new URL(`${assetBasePath}/${assetPath}`, publicOrigin).href
  const bootstrapHtml = createBootstrapHtml(
    assetUrl(scriptPath),
    stylePaths.map(assetUrl),
  )
  if (Buffer.byteLength(bootstrapHtml, 'utf8') >= 20_000) {
    throw new Error('The MCP App bootstrap HTML must remain below 20 KB.')
  }

  return {
    assetBasePath,
    bootstrapHtml,
    publicOrigin,
    scriptPath,
    stylePaths,
  }
}
