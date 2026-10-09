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

export {}
