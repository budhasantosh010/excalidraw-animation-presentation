import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: {
      './backgroundRemoval': resolve(
        __dirname,
        'src/mcpAppBackgroundRemoval.ts',
      ),
    },
  },
  build: {
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    manifest: true,
    outDir: 'dist-mcp-app',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'mcp-app.html'),
    },
  },
})
