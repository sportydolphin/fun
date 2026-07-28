import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  root: '.',
  plugins: [react(), cloudflare()],
  // Dev-server port can be assigned by tooling (e.g. Claude preview) via PORT.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})