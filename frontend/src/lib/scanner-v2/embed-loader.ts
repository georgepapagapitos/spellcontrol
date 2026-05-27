/* eslint-disable no-console -- Phase 2 spike diagnostics need to fire in
   the production-mode Capacitor build (logger.info is dev-only). Drop
   this disable when the embed pipeline either ships or is replaced. */
// Lazy-load onnxruntime-web + the MobileCLIP2-S0 vision encoder.
//
// Same loading shape as opencv-loader: vendor the runtime into
// `public/scanner-v2/ort/` and inject it via a dynamically-added classic
// `<script>` tag. Phase 0 proved that Capacitor's `WebViewLocalServer`
// hangs indefinitely when Vite tries to ship a large WASM-backed chunk
// through its ESM dynamic-import path; we apply the same lesson here so
// we don't repeat that diagnosis cycle for ORT.
//
// We use the `wasm`-only build (`ort.wasm.min.js`) — WebGPU evaluation is
// deferred. `ort.env.wasm.wasmPaths` is pointed at the vendored dir so
// the runtime can resolve `ort-wasm-simd-threaded.{mjs,wasm}` without
// going through Vite's chunk graph. `numThreads = 1` avoids any reliance
// on SharedArrayBuffer / cross-origin isolation, which Capacitor's
// `http://localhost` origin can't supply.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ort = any;

export interface OrtLoadResult {
  ort: Ort;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  scriptLoadMs: number;
  sessionLoadMs: number;
  totalLoadMs: number;
}

const ORT_SCRIPT_URL = '/scanner-v2/ort/ort.wasm.min.js';
const ORT_WASM_DIR = '/scanner-v2/ort/';
const MODEL_URL = '/scanner-v2/embed/vision_model.onnx';

let pending: Promise<OrtLoadResult> | null = null;

export function loadEmbedder(): Promise<OrtLoadResult> {
  if (pending) return pending;
  const t0 = performance.now();
  console.log('[scanner-v2] ort script-load start');

  pending = injectScript(ORT_SCRIPT_URL)
    .then(async () => {
      const scriptLoadMs = performance.now() - t0;
      console.log(`[scanner-v2] ort script loaded in ${scriptLoadMs.toFixed(0)}ms`);

      const win = window as unknown as { ort?: Ort };
      if (!win.ort) {
        throw new Error('ort.wasm.min.js loaded but global `ort` is missing');
      }
      const ort = win.ort;

      // Point ORT at the vendored WASM artifacts. Setting these before
      // session creation is required — once the WASM proxy initializes,
      // these are read-only.
      ort.env.wasm.wasmPaths = ORT_WASM_DIR;
      ort.env.wasm.numThreads = 1;
      // Quieter logging; ORT defaults to noisy "warning" level which spams
      // Capacitor's console.
      ort.env.logLevel = 'error';

      const sessionT0 = performance.now();
      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      const sessionLoadMs = performance.now() - sessionT0;
      const totalLoadMs = performance.now() - t0;
      console.log(
        `[scanner-v2] ort session ready: script=${scriptLoadMs.toFixed(0)}ms session=${sessionLoadMs.toFixed(0)}ms total=${totalLoadMs.toFixed(0)}ms inputs=${(session.inputNames as string[]).join(',')} outputs=${(session.outputNames as string[]).join(',')}`
      );
      return { ort, session, scriptLoadMs, sessionLoadMs, totalLoadMs };
    });

  pending.catch((err) => {
    console.error('[scanner-v2] ort load failed', err);
    pending = null;
  });
  return pending;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-scanner-v2-ort]`);
    if (existing) {
      if (existing.dataset.loaded === '1') resolve();
      else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('ort script load error')), {
          once: true,
        });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.scannerV2Ort = '1';
    script.addEventListener('load', () => {
      script.dataset.loaded = '1';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error(`ort script load error: ${src}`)));
    document.head.appendChild(script);
  });
}

export function resetEmbedderForTests(): void {
  pending = null;
}
