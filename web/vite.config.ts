import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
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
      // The backend API is served from src/app.ts under /api (added in a
      // later PR); this proxy lets `vite dev` talk to it without CORS setup.
      '/api': 'http://localhost:8080',
    },
  },
})
