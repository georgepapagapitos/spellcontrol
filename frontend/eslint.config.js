import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'android',
      // Vendored scanner blobs (opencv.js, onnxruntime-web bundle, ONNX
      // model, packed binary DBs). Third-party / generated; linting them
      // produces ~1000 errors that mask real issues elsewhere.
      'public/scanner/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Static accessibility lint (quality program, 2026-09-09): a11y, focus
      // and aria defects were ~27 fix PRs in the last thousand; this catches
      // the mechanical class at edit time. The CSS guards cover focus rings
      // and touch floors; the audit matrix measures the rendered result.
      ...jsxA11y.flatConfigs.recommended.rules,
      // Sheets and dialogs focus their first field on open on purpose; the
      // overlay layer (lib/overlay-layer.ts) restores focus on close. The
      // rule is an opinion about page loads, not about opened dialogs.
      'jsx-a11y/no-autofocus': 'off',
      // `role="list"` on a `<ul>` is deliberate: Safari/VoiceOver drops the
      // list semantics of any list styled `list-style: none`, and every
      // list here is. The explicit role restores them.
      'jsx-a11y/no-redundant-roles': ['error', { ul: ['list'], ol: ['list'] }],
      // A labelled `role="region"` that scrolls must take focus, or a keyboard
      // user cannot scroll it (WCAG 2.1.1; axe scrollable-region-focusable).
      // The rule's default allows only tabpanel; region joins it, nothing else.
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: [], roles: ['tabpanel', 'region'], allowExpressionValues: true },
      ],
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Apostrophes in user-facing copy stay readable in source; the rule
      // only enforces HTML-entity escaping which buys us nothing here.
      'react/no-unescaped-entities': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Route all logging through src/lib/logger so debug chatter stays out of
      // the production browser console; warn/error still surface in the field.
      'no-console': 'error',
    },
  },
  {
    // The logger wrapper is the one place console.* is allowed.
    files: ['src/lib/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  prettier,
];
