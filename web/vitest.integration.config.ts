import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Client integration tests: render the real app in jsdom against the REAL game
// server, started in-process (server/src) on an ephemeral port. The server's
// own deps (express, socket.io, cors) resolve from server/node_modules, so run
// `npm ci` in server/ first.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/test/integration/**/*.test.tsx'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
