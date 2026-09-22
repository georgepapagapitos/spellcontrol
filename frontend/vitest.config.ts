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
    // happy-dom fetches the href of any <link rel="stylesheet"> appended to
    // the document. The typeface picker appends real Google Fonts links, so
    // without this the suite makes live network calls — slow, offline-hostile,
    // and a source of unhandled NetworkError noise on teardown. No test should
    // ever need a remote stylesheet's contents.
    //
    // Disabling the load is not enough on its own: happy-dom then reports each
    // skipped <link> as a `DOMException [NotSupportedError]: Failed to load
    // external stylesheet` via console.error — 19 lines per full run, every
    // one of them a worker->main RPC landing near teardown. That volume is
    // exactly the `EnvironmentTeardownError: Closing rpc while
    // "onUserConsoleLog" was pending` trigger described under `silent` below,
    // and it reddened two runs in the first hour on vitest 5 (#1805's PR run
    // and main at 06800848) after 0 in the 30 main runs before. Treat the
    // disabled load as a success so the element fires `load`, not `error`,
    // and nothing is logged.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    globals: true,
    // Console interception is ON (the vitest default). It was off from #1810 to
    // E272 slice 3 because of the teardown flake that reddened main CI on and
    // off since 2026-07-16 (a red main CI skips the Fly deploy):
    //
    //   EnvironmentTeardownError: [vitest-worker]: Closing rpc while
    //   "onUserConsoleLog" was pending
    //
    // With interception on, vitest's console spy flushes each task's console.*
    // calls as a worker->main RPC; a flush still in flight when the worker tears
    // down is that error (vitest-dev/vitest#11153). The maintainer's diagnosis
    // there is the real root cause — test code still running after its test
    // ended — and `vitest run --detectAsyncLeaks` measured it: 416 leaks at the
    // start of E272, 0 after slice 3 (src/test/setup.ts drains IndexedDB hops
    // and cancels unread Response bodies; src/test/pending.ts settles "still
    // loading" promises after unmount; store tests flush the push debounce).
    // With nothing running past its test there is no late RPC to race.
    //
    // If the error ever returns, do NOT reach for `silent: 'passed-only'` — it
    // filters in the main-process reporter after the RPC was sent and never
    // touched the race. Re-measure with --detectAsyncLeaks (the leak is the
    // bug), and `disableConsoleIntercept: true` remains the emergency stopgap.
    // Vitest's defaults (5s per test, 10s per hook) are sized for an idle
    // machine. Several tests here are genuinely compute-heavy — the
    // substitute-weight eval and the commander-deck tagger analysis each burn
    // most of a second on an unloaded box — so when the suite runs alongside
    // other work (parallel worktrees, a second vitest run) they crossed the
    // line and produced a DIFFERENT failure set on every run, on an
    // unmodified tree. Raising the ceiling only costs wall-clock on a test
    // that was going to fail anyway; a passing test finishes exactly as fast.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Installs an in-memory `localStorage` shim for persisted stores; inert
    // for tests that don't touch storage.
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      // Every file matched by `include` is measured, imported by a test or
      // not, so the per-directory floors below reflect real logic coverage
      // rather than only test-touched files. (That is the built-in behavior
      // since vitest 4; the old `all: true` knob it replaced is gone.)
      include: [
        'src/lib/**/*.{ts,tsx}',
        'src/store/**/*.{ts,tsx}',
        'src/deck-builder/**/*.{ts,tsx}',
        'src/components/**/*.{ts,tsx}',
        'src/pages/**/*.{ts,tsx}',
        'src/playtest/**/*.{ts,tsx}',
      ],
      // Thin browser-API wrappers that need a real runtime (worker/WASM,
      // Screen Wake Lock + visibilitychange) and can't be exercised
      // meaningfully under the node test env — verified via integration use:
      //   - ocr.ts: tesseract.js worker + WASM
      //   - use-wake-lock.ts: navigator.wakeLock + visibilitychange
      //   - keyboard.ts: window.visualViewport resize/scroll glue
      exclude: [
        'src/lib/use-wake-lock.ts',
        'src/lib/keyboard.ts',
        // Network + IDB orchestration (fetch streaming, gzipped bulk loads,
        // progress callbacks). Verified via integration; not unit-testable
        // without a streaming-fetch shim that fights real-runtime behavior.
        'src/lib/offline/download.ts',
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
      // `src/store/**`, `src/deck-builder/**`, `src/components/**`,
      // `src/pages/**` and `src/playtest/**` are all gated on their current
      // measured baseline, rounded down a point as a small margin, so
      // coverage can no longer regress. Ratchet these upward as tests are
      // added — never lower them, and never drop the src/lib/** 80.
      //
      // Measuring a baseline: the text reporter's directory row (e.g.
      // `playtest | 92.4`) counts ONLY the files directly in that directory,
      // while a `src/playtest/**` threshold aggregates every subdirectory
      // (62% once playtest/components is in). Read the numbers the threshold
      // checker prints for a glob (set it to 100 and read the ERROR lines) or
      // sum the per-file rows; never the directory row. And measure with the
      // full, unfiltered suite: a CLI `--exclude` changes which files run and
      // moves the aggregate.
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
        'src/components/**': {
          statements: 53,
          branches: 47,
          functions: 47,
          lines: 53,
        },
        'src/pages/**': {
          statements: 46,
          branches: 39,
          functions: 40,
          lines: 47,
        },
        'src/playtest/**': {
          statements: 60,
          branches: 51,
          functions: 51,
          lines: 61,
        },
      },
    },
  },
});
