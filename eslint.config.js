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

      // CLAUDE.md's traps, as rules, so they are checked rather than remembered.
      'no-restricted-syntax': ['error',
        // MUI reads a bare `letterSpacing: 0.5` as 0.5px, which does not grow with the type
        // around it (rem, scaled per section and by the reader's Large text). 175 of them had
        // accumulated by Oct 2026, and px spacing is what re-wrapped headings across /mlb in the
        // rebuild. em and 0 are fine; `typePx(0.5)` keeps the number and makes it type.
        ...['', ' > UnaryExpression', ' > ConditionalExpression', ' > ConditionalExpression > UnaryExpression', ' > ObjectExpression > Property']
          .flatMap(path => [
            `Property[key.name='letterSpacing']${path} > Literal[raw=/^(0?\\.\\d*[1-9]|[1-9])/]`,
            `Property[key.name='letterSpacing']${path} > Literal[value=/^-?[0-9.]+px$/]`,
          ])
          .map(selector => ({ selector, message: 'letterSpacing in px does not scale with the type. Use typePx(n) from src/ui/scale (or em).' })),
        // A cancellable touch listener makes the browser wait for JavaScript before it scrolls
        // anything under it, so the content trails the finger (the player sheet until Oct 7, 2026).
        // The two that exist are deliberate and say so beside them.
        {
          selector: "Property[key.name='passive'] > Literal[value=false]",
          message: 'A passive:false touch listener makes scrolling wait on JavaScript. See the ModalShell trap in CLAUDE.md; if it is truly needed, disable this line with the reason.',
        },
      ],
    },
  },
  {
    // The share-card exporters render a fixed-size image with px type, where px spacing is right.
    files: ['src/wpbl/awardShareCard.tsx', 'src/wpbl/AwardsWinnersExport.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Node config files and the edge Functions run outside the browser.
    files: ['*.config.js', 'functions/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
)
