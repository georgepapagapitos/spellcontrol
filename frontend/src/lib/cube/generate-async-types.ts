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
import type { DraftSimOptions, DraftSimResult, CommanderDraftSimResult } from './draft-sim';

// A Commander cube's draft sim (board E461) rides the SAME 'draft-sim'
// request/response kind as the limited pod, distinguished only by an optional
// `legends` array on the request: present → simulateCommanderDraft, absent →
// simulateDraft (see generate.worker.ts). One worker path, one message pair,
// two pure functions behind it — not a parallel 'commander-draft-sim' kind.
export type CubeWorkerRequest =
  | { kind: 'generate'; pool: CubeCard[]; size: CubeSize; options?: CubeGenOptions }
  | {
      kind: 'draft-sim';
      cube: CubeCard[];
      size: CubeSize;
      options?: DraftSimOptions;
      legends?: CubeCard[];
    };

export type CubeWorkerResponse =
  | { type: 'progress'; pass: number; maxIter: number }
  | { type: 'result'; cube: GeneratedCube }
  | { type: 'draft-sim-result'; result: DraftSimResult | CommanderDraftSimResult }
  | { type: 'error'; message: string };

/** Refiner progress relayed to the loading UI (generate only — a draft sim
 *  runs well under a second, so it has no loading bar to feed). */
export interface CubeProgress {
  pass: number;
  maxIter: number;
}
