import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Mirror the `__BUILD_ID__` define from vite.config.ts so source files
  // that read it (lib/register-pwa.ts) compile under vitest. Tests that
  // need a specific value override via vi.stubGlobal('__BUILD_ID__', ...).
  define: {
    __BUILD_ID__: JSON.stringify('test-build-id'),
  },
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
      // `all: true` counts files in `include` even when no test imports
      // them — so the gate reflects real logic coverage, not just
      // test-touched files. Required for the per-directory floors below
      // to be honest.
      all: true,
      include: [
        'src/lib/**/*.{ts,tsx}',
        'src/store/**/*.{ts,tsx}',
        'src/deck-builder/**/*.{ts,tsx}',
      ],
      // Thin browser-API wrappers that need a real runtime (worker/WASM,
      // Screen Wake Lock + visibilitychange) and can't be exercised
      // meaningfully under the node test env — verified via integration use:
      //   - ocr.ts: tesseract.js worker + WASM
      //   - use-wake-lock.ts: navigator.wakeLock + visibilitychange
      //   - keyboard.ts: window.visualViewport resize/scroll glue +
      //     Capacitor Keyboard plugin listeners (platform-branched)
      exclude: [
        'src/lib/use-wake-lock.ts',
        'src/lib/keyboard.ts',
        // Network + IDB orchestration (fetch streaming, gzipped bulk loads,
        // progress callbacks). Verified via integration; not unit-testable
        // without a streaming-fetch shim that fights real-runtime behavior.
        'src/lib/offline/download.ts',
        // Capacitor plugin wrappers + DOM probing — paths are
        // platform-branched (`isNativePlatform()`) and the native side
        // calls plugins that don't exist outside the Capacitor WebView.
        // Verified on-device, not in the node test env:
        //   - platform.ts: StatusBar + theme luminance probe
        //   - native-file-picker.ts: FilePicker + fetch(content://)
        //   - haptics.ts: Capacitor Haptics + navigator.vibrate
        //   - deep-links.ts: App.appUrlOpen / getLaunchUrl listener glue
        //     (`parseDeepLink` is still unit-tested separately —
        //     excluding the file drops the measurement, not the test.)
        'src/lib/platform.ts',
        'src/lib/native-file-picker.ts',
        'src/lib/haptics.ts',
        'src/lib/deep-links.ts',
        // Scanner OpenCV.js (WASM) loader + classical detector. The
        // heavy lifting is a ~10MB WASM module that won't initialize
        // under node, so the pipeline is device-validated, not
        // unit-gated. Pure helpers like `orderQuadCorners` are tested
        // directly.
        'src/lib/scanner/opencv-loader.ts',
        'src/lib/scanner/detect.ts',
        // Scanner pipeline wrapper. `scan.ts` glues opencv (WASM),
        // canvas.toBlob, fetch (the server matcher), and the offline
        // pHash fallback together — every meaningful branch needs a
        // real browser runtime. Pure helpers (`classify`,
        // `serverBodyToScanResult`, `phashHitsToScanResult`) are
        // exported and unit-tested separately; excluding the wrapper
        // file drops the measurement, not the test.
        'src/lib/scanner/scan.ts',
        // Deck-builder network service clients — large fetch wrappers around
        // EDHREC / Scryfall / the tagger endpoint. Same rationale as ocr.ts:
        // exercising them meaningfully needs a fetch shim that fights real
        // runtime behavior, so they are integration-verified, not unit-gated.
        // Excluding them lets the deck-builder floor reflect the testable
        // pure helper + phase layer instead of being dragged by IO glue.
        'src/deck-builder/services/edhrec/client.ts',
        'src/deck-builder/services/scryfall/client.ts',
        'src/deck-builder/services/tagger/client.ts',
      ],
      // Per-directory floors. `src/lib/**` stays the long-standing 80.
      // `src/store/**` and `src/deck-builder/**` are newly gated: the
      // floors are their current measured baselines, rounded down with a
      // small margin, so coverage can no longer regress. Ratchet these
      // upward as tests are added — never lower them, and never drop the
      // src/lib/** 80.
      thresholds: {
        'src/lib/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/store/**': {
          statements: 89,
          branches: 74,
          functions: 92,
          lines: 90,
        },
        'src/deck-builder/**': {
          statements: 52,
          branches: 41,
          functions: 58,
          lines: 55,
        },
      },
    },
  },
});
