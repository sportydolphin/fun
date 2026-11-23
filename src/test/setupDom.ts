// ─── Chunks the app preloads and nothing awaits ──────────────────────────────────
//
// Game Center warms the win probability chart the moment it opens (`preloadWinProb` in
// RecapCard.tsx): a fire-and-forget `import()`, which is right for a reader and wrong for a test
// runner. A test that opens Game Center can finish while that import is still being fetched, and
// the worker then shuts down underneath it: every test passes and the run still fails, with
// `Closing rpc while "fetch" was pending`, from whichever file lost the race. That failed CI on
// Oct 9, 2026 for a change that touched no source at all.
//
// Loaded here, the module is already in the registry when the preload asks for it, so there is
// nothing left in flight at teardown. Add a chunk here if another preload starts showing up.
await import('../wpbl/WinProbView')

// ─── Every other import still in flight when a file ends ─────────────────────────
//
// The list above only covers a preload someone has already been bitten by, and the app has many:
// opening search starts `intl/worldCupSearchRows` (and with it every flag SVG), and an idle
// WpblApp warms the game sheet, the player card and four tabs. commandPalette.test.tsx renders the
// whole App, so on a slow runner its last test could end with one of those graphs half loaded:
// 4,081 tests passed and the run failed with `EnvironmentTeardownError: Cannot load ... after the
// environment was torn down`. That turned `main` red four times between Nov 7 and Nov 10, 2026,
// each on a pull request that had passed.
//
// Waiting here holds the environment open until whatever was started has finished, whichever
// module it was. It cannot cover an import a timer starts after this hook, so a component that
// preloads on a timer must cancel it on unmount, as `usePreloadGameDetail` does.
afterAll(async () => { await vi.dynamicImportSettled() })

export {}
