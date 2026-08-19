import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    // TypeScript/ESLint resolve the "#*" subpath imports (package.json
    // "imports" field) on their own; Vite's bundler doesn't consult that
    // field, so it needs the equivalent mapping spelled out here too.
    alias: [
      {
        find: /^#/,
        replacement: `${path.resolve(import.meta.dirname, 'src')}/`,
      },
    ],
  },
  server: {
    proxy: {
      // Lets `vite dev` call the backend's /api routes without CORS setup.
      '/api': 'http://localhost:8080',
    },
  },
})
