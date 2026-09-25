// Message shapes shared by generate-async.ts (main thread) and
// generate.worker.ts (worker thread) — kept in their own module so both sides
// import the same types without the worker pulling in the wrapper.

import type { CubeCard } from './core';
import type { CubeSize } from './targets';
import type { CubeGenOptions, GeneratedCube } from './generate';

export interface CubeWorkerRequest {
  pool: CubeCard[];
  size: CubeSize;
  options?: CubeGenOptions;
}

export type CubeWorkerResponse =
  | { type: 'progress'; pass: number; maxIter: number }
  | { type: 'result'; cube: GeneratedCube }
  | { type: 'error'; message: string };

/** Refiner progress relayed to the loading UI. */
export interface CubeProgress {
  pass: number;
  maxIter: number;
}
