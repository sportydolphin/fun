import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { wpblPortraitAssets } from './scripts/vite-plugin-wpbl-portraits.mjs'

export default defineConfig({
  root: '.',
  plugins: [react(), wpblPortraitAssets()],
  // Dev-server port can be assigned by tooling (e.g. Claude preview) via PORT.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
  // NOTE: a manualChunks split of MUI/React into separate vendor chunks was tried and
  // reverted — it produced a circular import between the two chunks (react-vendor ⇄ mui,
  // because MUI's transitive deps straddled the split), which broke module init order and
  // blanked the page on a fresh load. Any future vendor-splitting must keep React + MUI +
  // emotion (and their shared utils) in ONE chunk and be verified in a real browser first.
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Vitest's default excludes don't cover `.claude/worktrees/`, where agent tooling leaves
    // full checkouts of the repo — each with its OWN node_modules. Without this, the runner
    // globs those copies' test files and loads a second React alongside ours, so every hook
    // blows up with "Cannot read properties of null (reading 'useState')". Spread the
    // defaults rather than replacing them: setting `exclude` overrides the built-in list.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
