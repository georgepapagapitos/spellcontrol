import { generateCube } from './generate';
import { simulateDraft } from './draft-sim';
import type { CubeWorkerRequest, CubeWorkerResponse } from './generate-async-types';

/**
 * Cube generation and draft simulation, off the main thread. The refiner alone
 * measured 0.6-6.9s for a 180-720 card cube (stress harness) — long enough to
 * freeze the tab and stall the loading block's own animation. Draft sim is far
 * cheaper (well under a second for 50 pods, see draft-sim.test.ts) but still
 * routes through this worker so a mid-size collection doesn't jank the Cards
 * tab on expand. Mirrors offline/combos-import.worker.ts.
 */
self.onmessage = (e: MessageEvent<CubeWorkerRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'draft-sim') {
      const result = simulateDraft(req.cube, req.size, req.options);
      self.postMessage({ type: 'draft-sim-result', result } satisfies CubeWorkerResponse);
      return;
    }
    const { pool, size, options } = req;
    // Throttled: the refiner can run hundreds of passes, and posting one message
    // per pass would itself become the jank this worker exists to avoid.
    let lastPost = 0;
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
