import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/renderer/src/**/*.test.{ts,tsx}'],
    setupFiles: 'src/renderer/src/test/setup.ts'
  }
})
