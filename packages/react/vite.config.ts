import { defineConfig } from 'vite'

// Library build to produce a single IIFE bundle exposing window.SmartRTE
export default defineConfig({
  build: {
    lib: {
      entry: 'src/standalone/classic-editor-embed.tsx',
      name: 'SmartRTE',
      formats: ['iife'],
      fileName: () => 'editor.js',
    },
    outDir: 'dist/standalone',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
})




