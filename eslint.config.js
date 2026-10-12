import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'

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
  // ACCESSIBILITY, the static half. The layout sweep runs axe on the rendered pages for what only a
  // browser can see (contrast, names, labels); this catches what is wrong in the source before it
  // renders, chiefly a click handler on something a keyboard cannot reach. 130 of those had built
  // up by Oct 2026: the account menu, the footer's Feedback and What's new, every carousel arrow.
  // MUI's Box is read as the element its `component` prop names, so `<Box onClick>` is a div.
  {
    files: ['src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    settings: { 'jsx-a11y': { polymorphicPropName: 'component', components: { Box: 'div', Typography: 'p', Stack: 'div' } } },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      // A control is something you click or press. Pointer hover, an image's onError and a scroll
      // listener are not, and the stock list counts them.
      ...Object.fromEntries(['no-static-element-interactions', 'no-noninteractive-element-interactions'].map(r => [`jsx-a11y/${r}`, ['error', {
        handlers: ['onClick', 'onMouseDown', 'onMouseUp', 'onKeyPress', 'onKeyDown', 'onKeyUp'],
      }]])),
      // OFF: every autoFocus here is a dialog putting the cursor in its first field, which is the
      // behaviour a dialog is expected to have.
      'jsx-a11y/no-autofocus': 'off',
      // OFF: deprecated by the plugin itself in favour of label-has-associated-control.
      'jsx-a11y/label-has-for': 'off',
      // A `tabIndex={collapsible ? 0 : undefined}` beside a role that is set on the same condition.
      'jsx-a11y/no-noninteractive-tabindex': ['error', { allowExpressionValues: true }],
    },
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'unused-imports': unusedImports },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // AN ERROR, and every deliberate omission says so with a disable and the reason beside it.
      // As a warning it sat at 45 in every run's output, where a new one was invisible, and two of
      // the 45 were real: Draft value and the TrackingView board each built season totals from the
      // schedule they saw first, so a schedule that arrived later never reached them. A missing
      // dependency is still a judgement per hook, which is exactly why it has to stop CI.
      'react-hooks/exhaustive-deps': 'error',

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
