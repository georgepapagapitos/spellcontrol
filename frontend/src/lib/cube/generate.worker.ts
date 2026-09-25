import { generateCube } from './generate';
import type { CubeWorkerRequest, CubeWorkerResponse } from './generate-async-types';

/**
 * Cube generation, off the main thread. The refiner alone measured 0.6-6.9s
 * for a 180-720 card cube (stress harness) — long enough to freeze the tab and
 * stall the loading block's own animation. Mirrors offline/combos-import.worker.ts.
 */
self.onmessage = (e: MessageEvent<CubeWorkerRequest>) => {
  const { pool, size, options } = e.data;
  // Throttled: the refiner can run hundreds of passes, and posting one message
  // per pass would itself become the jank this worker exists to avoid.
  let lastPost = 0;
  try {
    const cube = generateCube(pool, size, {
      ...options,
      onProgress: (pass, maxIter) => {
        const now = Date.now();
        if (now - lastPost < 100 && pass < maxIter - 1) return;
        lastPost = now;
        self.postMessage({ type: 'progress', pass, maxIter } satisfies CubeWorkerResponse);
      },
    });
    self.postMessage({ type: 'result', cube } satisfies CubeWorkerResponse);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies CubeWorkerResponse);
  }
};
