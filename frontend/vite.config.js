import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // ws: live lecture captions stream over /api/v1/lecture/stream.
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false, ws: true } },
  },
})
