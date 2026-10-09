import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { wpblImageAssets } from './scripts/vite-plugin-wpbl-images.mjs'
import { wpblPreload } from './scripts/vite-plugin-wpbl-preload.mjs'
import { noDevCode } from './scripts/vite-plugin-no-dev-code.mjs'

// Bundled for the test runner; see `deps` under `test`.
const MUI_DEPS = ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled']

export default defineConfig({
  root: '.',
  plugins: [react(), wpblImageAssets(), wpblPreload(), noDevCode()],
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
  build: {
    // NEVER INLINE A FACE. Vite turns any asset under 4 KB into a base64 data URL inside the chunk
    // that imports it, and portraits.ts imports all 118 player thumbnails eagerly (it needs the
    // name-to-URL map), so every thumbnail landed in the ENTRY chunk: 187 KB of base64, about a
    // third of what every visitor downloaded before anything could render, for faces the page
    // mostly never draws. As files they cost a request each, only for the faces actually on
    // screen, and they are hashed and cached for good. Anything else keeps the default rule.
    assetsInlineLimit: (filePath) =>
      /[\\/]src[\\/]wpbl[\\/](portraits|managers)[\\/]/.test(filePath) ? false : undefined,
  },
  // NOTE: a manualChunks split of MUI/React into separate vendor chunks was tried and
  // reverted — it produced a circular import between the two chunks (react-vendor ⇄ mui,
  // because MUI's transitive deps straddled the split), which broke module init order and
  // blanked the page on a fresh load. Any future vendor-splitting must keep React + MUI +
  // emotion (and their shared utils) in ONE chunk and be verified in a real browser first.
  test: {
    globals: true,
    // A BROWSER ONLY WHERE A TEST RENDERS. Every file used to start in jsdom, and two thirds of
    // them are pure logic (stats, derivations, routes) that never touch it: building the window
    // cost more worker time than the tests themselves (361s against 69s on Oct 9, 2026). The
    // .tsx files render, so they get jsdom; the .ts files run in Node, and one that does need a
    // DOM says so in its first line with `// @vitest-environment jsdom`, which wins over this.
    projects: [
      { extends: true, test: { name: 'dom', include: ['src/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['./src/test/setupDom.ts'] } },
      { extends: true, test: { name: 'node', include: ['src/**/*.test.ts'], environment: 'node' } },
    ],
    setupFiles: './src/test/setup.ts',
    // PLACEHOLDERS, NEVER THE REAL PROJECT. `src/lib/supabase.ts` builds its client at import time
    // and throws without a URL, so the suite used to pass only on a machine with a `.env`, which
    // also meant every test that imported it held a live client on the production database. CI has
    // no `.env` and should not; a test that needs data mocks the client. These win over `.env`.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_VAPID_PUBLIC_KEY: 'test-vapid-key',
    },
    // Vitest's default excludes don't cover `.claude/worktrees/`, where agent tooling leaves
    // full checkouts of the repo — each with its OWN node_modules. Without this, the runner
    // globs those copies' test files and loads a second React alongside ours, so every hook
    // blows up with "Cannot read properties of null (reading 'useState')". Spread the
    // defaults rather than replacing them: setting `exclude` overrides the built-in list.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
    // MUI PRE-BUNDLED, ONCE. Each test file loads its own module graph, and MUI plus its icons is
    // hundreds of small files, so every file that rendered a Box paid for all of them again:
    // imports were 1,276 worker-seconds of an 87s run. Bundled into one file per environment the
    // suite runs in 22s. The cost is that a test cannot vi.mock a single MUI module; none does.
    deps: {
      optimizer: {
        client: { enabled: true, include: MUI_DEPS },
        ssr: { enabled: true, include: MUI_DEPS },
      },
    },
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
