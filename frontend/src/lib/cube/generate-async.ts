// generateCube and simulateDraft, off the main thread. Follows the pattern in
// lib/offline/ensure-combos.ts: a module worker, an inline fallback when
// workers are unavailable or under test, and an inline fallback when the
// worker itself errors. Both requests share one worker file
// (generate.worker.ts, see generate-async-types.ts) but keep separate
// generation counters below — simulating a draft must never supersede an
// in-flight cube build, or vice versa.
//
// Staleness: a module-level generation counter drops any result that isn't
// from the most recent call of its own kind (a second Build click, or a page
// leave, makes the previous call's eventual result a no-op) — the app only
// ever has one cube build, and separately one draft sim, in flight at a time.
// An optional AbortSignal additionally terminates the worker / short-circuits
// the inline run early, so a superseded call stops burning CPU instead of
// merely being ignored on arrival.

import { generateCube, type CubeGenOptions, type GeneratedCube } from './generate';
import { simulateDraft, type DraftSimOptions, type DraftSimResult } from './draft-sim';
import type { CubeCard } from './core';
import type { CubeSize } from './targets';
import type { CubeProgress, CubeWorkerRequest, CubeWorkerResponse } from './generate-async-types';
import { logger } from '../logger';

export type { CubeProgress };

const abortError = () => new DOMException('Superseded by a newer build', 'AbortError');

/** No usable Worker (SSR/old browser), or under test — take the inline path. */
const noWorker = () => typeof Worker === 'undefined' || import.meta.env.MODE === 'test';

function newCubeWorker(): Worker {
  return new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
}

// ── Cube generation ─────────────────────────────────────────────────────────

export interface GenerateCubeAsyncHandlers {
  onProgress?: (progress: CubeProgress) => void;
  signal?: AbortSignal;
}

let currentGen = 0;

export function generateCubeAsync(
  pool: CubeCard[],
  size: CubeSize,
  options?: CubeGenOptions,
  { onProgress, signal }: GenerateCubeAsyncHandlers = {}
): Promise<GeneratedCube> {
  const gen = ++currentGen;
  const stale = () => gen !== currentGen || Boolean(signal?.aborted);

  if (noWorker()) {
    return runGenerateInline(pool, size, options, onProgress, stale);
  }
  return runGenerateWorker(pool, size, options, onProgress, signal, stale);
}

/** Deferred to a microtask so a second call made before the first's work runs
 *  can still supersede it (see the staleness test). */
function runGenerateInline(
  pool: CubeCard[],
  size: CubeSize,
  options: CubeGenOptions | undefined,
  onProgress: ((p: CubeProgress) => void) | undefined,
  stale: () => boolean
): Promise<GeneratedCube> {
  return Promise.resolve().then(() => {
    if (stale()) throw abortError();
    const cube = generateCube(pool, size, {
      ...options,
      onProgress: onProgress
        ? (pass, maxIter) => {
            if (!stale()) onProgress({ pass, maxIter });
          }
        : undefined,
    });
    if (stale()) throw abortError();
    return cube;
  });
}

function runGenerateWorker(
  pool: CubeCard[],
  size: CubeSize,
  options: CubeGenOptions | undefined,
  onProgress: ((p: CubeProgress) => void) | undefined,
  signal: AbortSignal | undefined,
  stale: () => boolean
): Promise<GeneratedCube> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = newCubeWorker();
    } catch {
      runGenerateInline(pool, size, options, onProgress, stale).then(resolve, reject);
      return;
    }
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort);

    worker.onmessage = (e: MessageEvent<CubeWorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        if (!stale()) onProgress?.({ pass: msg.pass, maxIter: msg.maxIter });
        return;
      }
      finish();
      if (stale()) {
        reject(abortError());
      } else if (msg.type === 'result') {
        resolve(msg.cube);
      } else if (msg.type === 'error') {
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      logger.warn('[cube] generate worker crashed:', e.message);
      finish();
      runGenerateInline(pool, size, options, onProgress, stale).then(resolve, reject);
    };
    // Strip onProgress before it crosses the postMessage boundary — a
    // function isn't structured-cloneable, and progress goes through the
    // worker's own message channel instead.
    const { onProgress: _dropped, ...wireOptions } = options ?? {};
    worker.postMessage({
      kind: 'generate',
      pool,
      size,
      options: wireOptions,
    } satisfies CubeWorkerRequest);
  });
}

// ── Draft simulation ─────────────────────────────────────────────────────────
// Same shape as generation above, minus progress (a run of 50 pods is well
// under a second — see draft-sim.test.ts — so there's no loading bar to feed).

export interface SimulateDraftAsyncHandlers {
  signal?: AbortSignal;
}

let currentDraftGen = 0;

export function simulateDraftAsync(
  cube: CubeCard[],
  size: CubeSize,
  options?: DraftSimOptions,
  { signal }: SimulateDraftAsyncHandlers = {}
): Promise<DraftSimResult> {
  const gen = ++currentDraftGen;
  const stale = () => gen !== currentDraftGen || Boolean(signal?.aborted);

  if (noWorker()) {
    return runDraftSimInline(cube, size, options, stale);
  }
  return runDraftSimWorker(cube, size, options, signal, stale);
}

function runDraftSimInline(
  cube: CubeCard[],
  size: CubeSize,
  options: DraftSimOptions | undefined,
  stale: () => boolean
): Promise<DraftSimResult> {
  return Promise.resolve().then(() => {
    if (stale()) throw abortError();
    const result = simulateDraft(cube, size, options);
    if (stale()) throw abortError();
    return result;
  });
}

function runDraftSimWorker(
  cube: CubeCard[],
  size: CubeSize,
  options: DraftSimOptions | undefined,
  signal: AbortSignal | undefined,
  stale: () => boolean
): Promise<DraftSimResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = newCubeWorker();
    } catch {
      runDraftSimInline(cube, size, options, stale).then(resolve, reject);
      return;
    }
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort);

    worker.onmessage = (e: MessageEvent<CubeWorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') return; // not ours on this worker call
      finish();
      if (stale()) {
        reject(abortError());
      } else if (msg.type === 'draft-sim-result') {
        resolve(msg.result);
      } else if (msg.type === 'error') {
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      logger.warn('[cube] draft-sim worker crashed:', e.message);
      finish();
      runDraftSimInline(cube, size, options, stale).then(resolve, reject);
    };
    worker.postMessage({ kind: 'draft-sim', cube, size, options } satisfies CubeWorkerRequest);
  });
}
