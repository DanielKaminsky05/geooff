/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // map-data (raw SVG paths, ~1.4MB / ~450kB gzip) is the one chunk over the
    // default 500kB, by nature; it loads only with the match route.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // The SVG map paths (~1.2MB) change ~never: give them their own
            // long-cached chunk instead of folding them into the Match page
            // chunk, so an app update doesn't re-download them. Only the match
            // route imports lib/maps, so Home and Lobby never load this.
            { name: 'map-data', test: /node_modules[\\/]@svg-maps[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Real-server integration tests run separately: npm run test:integration
    exclude: [...configDefaults.exclude, 'src/test/integration/**'],
  },
})
