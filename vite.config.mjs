import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { wpblPortraitAssets } from './scripts/vite-plugin-wpbl-portraits.mjs'

export default defineConfig({
  root: '.',
  plugins: [react(), wpblPortraitAssets()],
  // Dev-server port can be assigned by tooling (e.g. Claude preview) via PORT.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
})
