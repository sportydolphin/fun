import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { wpblPortraitAssets } from './scripts/vite-plugin-wpbl-portraits.mjs'
import { wpblPreload } from './scripts/vite-plugin-wpbl-preload.mjs'

export default defineConfig({
  root: '.',
  plugins: [react(), wpblPortraitAssets(), wpblPreload()],
  // Dev-server port can be assigned by tooling (e.g. Claude preview) via PORT.
  //
  // `strictPort` on the default branch, so a busy 5173 FAILS instead of quietly moving to 5174.
  // The port used to be an irrelevance; it stopped being one when auth links arrived. A Supabase
  // reset or confirmation link redirects to an origin that has to be in the project's allow-list,
  // and an origin that is not on it does not error: Supabase substitutes the Site URL, so the
  // link lands on production and the thing you were testing never runs. A drifting dev port
  // breaks that match silently, one port at a time. Loud is better here.
  //
  // A second dev server therefore has to say so: `PORT=5174 npm run dev`, which takes the
  // branch above and drops the constraint.
  server: process.env.PORT
    ? { port: Number(process.env.PORT) }
    : { port: 5173, strictPort: true },
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
    server: {
      deps: {
        // The cron scripts under scripts/ are Node CLI programs and start with a shebang.
        // Node strips that when it imports them; Vite's transform does not, so a script that
        // gets pulled through the transform dies on `#!` with "Invalid or unexpected token",
        // pointing at line 1 of a file that is perfectly valid.
        //
        // Which scripts got pulled in was luck: a script importing `pg` was externalised and
        // loaded natively, while one importing `@supabase/supabase-js` (a dep Vite processes
        // for the app) was inlined along with it. That is why only one of the two script
        // tests failed. Externalising the whole directory settles it for every script, now
        // and for the next test that imports one.
        // Both separators: the matched id is an absolute path, which is backslashed on Windows.
        external: [/[\\/]scripts[\\/].*\.mjs$/],
      },
    },
  },
})
