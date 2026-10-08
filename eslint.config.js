import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'

// THE LINT, run in CI beside tsc, the tests and the build (.github/workflows/ci.yml).
//
// It started (Oct 8, 2026) with the rules that find real defects, at error, and nothing that is only
// taste. The first run found two of those: a `useIsAdmin() || useIsTester()` that skipped a hook on
// some renders (React throws "Rendered fewer hooks"), and two test regexes holding a literal
// backspace where `\b` was meant, so the assertions in them could never fail. Unused imports and
// variables are errors because a refactor here leaves them behind every time, and the next reader
// cannot tell a dead import from a live one.
//
// Rules are OFF only with a reason beside them. Turning one on later is a sweep of its own.

export default tseslint.config(
  {
    ignores: [
      'dist/**', 'node_modules/**', '.claude/**', '.wrangler/**', 'public/**', 'android/**',
      // Not part of the app's TypeScript build: Deno edge functions and the Node cron scripts.
      'supabase/**', 'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'unused-imports': unusedImports },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // A warning, not an error: the codebase has deliberate omissions with a comment beside them,
      // and a missing dependency is a judgement per effect rather than a mechanical fix.
      'react-hooks/exhaustive-deps': 'warn',

      // An unused import is removed by `npm run lint -- --fix`; an unused variable is reported and
      // left for a person, since it is as often a half-finished change as dead code.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', {
        // `_name` says "unused on purpose": a positional argument, a destructured field left out.
        args: 'after-used', argsIgnorePattern: '^_', vars: 'all', varsIgnorePattern: '^_',
        caughtErrors: 'none', ignoreRestSiblings: true,
      }],

      // OFF: 258 uses, almost all at the edge of an untyped feed payload. Typing those is real work
      // with its own review, not a lint sweep.
      '@typescript-eslint/no-explicit-any': 'off',
      // An empty `catch` is this codebase's way of saying "storage is off, carry on", always with a
      // comment; an empty block anywhere else is still an error.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // A no-break space in a template or in JSX text is deliberate (a number kept beside its unit).
      'no-irregular-whitespace': ['error', { skipTemplates: true, skipJSXText: true, skipStrings: true }],
      // TypeScript resolves names; ESLint's own check does not know the DOM's types and would flag
      // every `RequestInit`.
      'no-undef': 'off',
    },
  },
  {
    // Node config files and the edge Functions run outside the browser.
    files: ['*.config.js', 'functions/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
)
