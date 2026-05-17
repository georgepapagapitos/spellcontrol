import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the `@/` alias from vite.config.ts so source files that
    // value-import (not just type-import) via the alias resolve under
    // vitest. Type-only imports are stripped before resolution so they
    // appeared to work without this.
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // Installs an in-memory `localStorage` shim for persisted stores; inert
    // for tests that don't touch storage.
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
      // ocr.ts is a thin wrapper around tesseract.js that requires a real
      // browser worker + WASM runtime. Unit tests can't exercise it
      // meaningfully — its behaviour is verified by integration use of the
      // scanner UI.
      exclude: ['src/lib/ocr.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
