/* eslint-disable no-console -- Phase 0 diagnostics need to fire in the
   production-mode Capacitor build (logger.info is dev-only), so we use
   console.* directly. Remove this disable when the spike either ships
   or is replaced. */
// Lazy-load OpenCV.js once per session.
//
// We vendor @techstark/opencv-js's `opencv.js` into `public/scanner/` and
// load it via a dynamically-injected classic `<script>` tag. This bypasses
// Vite's ESM dynamic-import + chunk-graph machinery, which hung
// indefinitely under Capacitor's `WebViewLocalServer` when fed the 10 MB
// chunk (request received, never resolved, JS engine idle at 0% CPU).
// Classic-script loading is also the pattern the official OpenCV.js docs
// use, and the resulting global `cv` is exactly what Emscripten expects.
//
// The script sets a global `cv` whose `Mat` property becomes a function
// once the WASM heap is initialized. We poll for `Mat` instead of relying
// on `onRuntimeInitialized` — the callback only fires once, and on a fast
// path it can fire before our handler is attached, which then hangs forever.
// Polling is timing-agnostic.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenCv = any;

export interface OpenCvLoadResult {
  cv: OpenCv;
  loadMs: number;
}

const OPENCV_URL = '/scanner/opencv.js';
const READY_TIMEOUT_MS = 30_000;
const POLL_MS = 50;

let pending: Promise<OpenCvLoadResult> | null = null;

export function loadOpenCv(): Promise<OpenCvLoadResult> {
  if (pending) return pending;
  const t0 = performance.now();
  console.log('[scanner] opencv script-load start');

  pending = injectScript(OPENCV_URL).then(() => {
    const scriptMs = performance.now() - t0;
    console.log(`[scanner] opencv script loaded in ${scriptMs.toFixed(0)}ms; awaiting Mat`);

    // The UMD shim attaches `cv` to the global scope. Type-narrow without
    // ambient declarations to avoid leaking opencv globals into the rest
    // of the app's types.
    const win = window as unknown as { cv?: { Mat?: unknown } };
    if (!win.cv) {
      throw new Error('opencv.js loaded but global `cv` is missing');
    }

    if (typeof win.cv.Mat === 'function') {
      const loadMs = performance.now() - t0;
      console.log(`[scanner] opencv ready (already initialized) in ${loadMs.toFixed(0)}ms`);
      return { cv: win.cv as OpenCv, loadMs };
    }

    return waitForMat(win, t0);
  });

  pending.catch((err) => {
    console.error('[scanner] opencv load failed', err);
    pending = null;
  });
  return pending;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // De-dupe so concurrent loadOpenCv() callers share one fetch+parse.
    const existing = document.querySelector<HTMLScriptElement>(`script[data-scanner-opencv]`);
    if (existing) {
      if (existing.dataset.loaded === '1') resolve();
      else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('opencv script load error')), {
          once: true,
        });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.scannerOpencv = '1';
    script.addEventListener('load', () => {
      script.dataset.loaded = '1';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error(`opencv script load error: ${src}`)));
    document.head.appendChild(script);
  });
}

function waitForMat(win: { cv?: { Mat?: unknown } }, t0: number): Promise<OpenCvLoadResult> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let polls = 0;
    const interval = setInterval(() => {
      polls++;
      if (win.cv && typeof win.cv.Mat === 'function') {
        clearInterval(interval);
        const loadMs = performance.now() - t0;
        console.log(
          `[scanner] opencv ready (polled ${polls}x over ${(performance.now() - startedAt).toFixed(0)}ms) in ${loadMs.toFixed(0)}ms`
        );
        resolve({ cv: win.cv as OpenCv, loadMs });
        return;
      }
      if (performance.now() - startedAt > READY_TIMEOUT_MS) {
        clearInterval(interval);
        const keys = win.cv
          ? Object.keys(win.cv as object)
              .slice(0, 20)
              .join(', ')
          : '(no cv global)';
        console.error(`[scanner] opencv ready timeout after ${READY_TIMEOUT_MS}ms — keys: ${keys}`);
        reject(new Error(`OpenCV ready timeout (${READY_TIMEOUT_MS}ms)`));
      }
    }, POLL_MS);
  });
}

export function resetOpenCvLoaderForTests(): void {
  pending = null;
}
