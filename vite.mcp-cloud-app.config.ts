import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/mcp-app/',
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: {
      './backgroundRemoval': resolve(
        import.meta.dirname,
        'src/mcpAppBackgroundRemoval.ts',
      ),
    },
  },
  build: {
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    manifest: false,
    outDir: 'public/mcp-app-assets',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'mcp-app.html'),
      output: {
        entryFileNames: 'animation-studio.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith('.css'))
            ? 'animation-studio.css'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
})
