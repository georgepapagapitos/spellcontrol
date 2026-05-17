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
      // Thin browser-API wrappers that need a real runtime (worker/WASM,
      // Screen Wake Lock + visibilitychange) and can't be exercised
      // meaningfully under the node test env — verified via integration use:
      //   - ocr.ts: tesseract.js worker + WASM
      //   - use-wake-lock.ts: navigator.wakeLock + visibilitychange
      exclude: ['src/lib/ocr.ts', 'src/lib/use-wake-lock.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
