// Message shapes shared by generate-async.ts (main thread) and
// generate.worker.ts (worker thread) — kept in their own module so both sides
// import the same types without the worker pulling in the wrapper.
//
// Two request kinds share one worker file: generating a cube, and simulating
// a draft off an already-built one. They're independent asks (see
// generate-async.ts's two separate generation counters) that happen to be
// cheap to route through the same module worker.

import type { CubeCard } from './core';
import type { CubeSize } from './targets';
import type { CubeGenOptions, GeneratedCube } from './generate';
import type { DraftSimOptions, DraftSimResult } from './draft-sim';

export type CubeWorkerRequest =
  | { kind: 'generate'; pool: CubeCard[]; size: CubeSize; options?: CubeGenOptions }
  | { kind: 'draft-sim'; cube: CubeCard[]; size: CubeSize; options?: DraftSimOptions };

export type CubeWorkerResponse =
  | { type: 'progress'; pass: number; maxIter: number }
  | { type: 'result'; cube: GeneratedCube }
  | { type: 'draft-sim-result'; result: DraftSimResult }
  | { type: 'error'; message: string };

/** Refiner progress relayed to the loading UI (generate only — a draft sim
 *  runs well under a second, so it has no loading bar to feed). */
export interface CubeProgress {
  pass: number;
  maxIter: number;
}
