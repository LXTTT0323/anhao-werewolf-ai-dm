import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/socket.io': { target: 'http://127.0.0.1:8787', ws: true },
    },
  },
})
