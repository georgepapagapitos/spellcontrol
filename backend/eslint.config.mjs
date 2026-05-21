import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Route all logging through src/logger so per-request debug chatter
      // stays out of production logs; info/warn/error still surface.
      'no-console': 'error',
    },
  },
  {
    // The logger wrapper is the one place console.* is allowed.
    files: ['src/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests and test infrastructure log freely.
    files: ['**/*.test.ts', 'src/test-helpers.ts', 'vitest.global-setup.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
];
