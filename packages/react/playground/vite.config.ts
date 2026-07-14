import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Keep the playground on live package source so editor changes are
      // reflected by HMR without requiring a package dist rebuild.
      'smartrte-react': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: true,
    strictPort: true,
    port: 5173,
    allowedHosts: true,
    watch: {
      usePolling: true,
    }
  }
})
