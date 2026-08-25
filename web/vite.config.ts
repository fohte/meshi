import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    proxy: {
      // Lets `vite dev` call the backend's /api routes without CORS setup.
      '/api': 'http://localhost:8080',
    },
  },
})
