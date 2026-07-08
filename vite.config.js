import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '.',
  plugins: [react()],
  // Dev-server port can be assigned by tooling (e.g. Claude preview) via PORT.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
