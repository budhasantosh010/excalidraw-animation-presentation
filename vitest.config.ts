import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      'mcp/**/*.test.ts',
      'worker/**/*.test.ts',
    ],
  },
})
