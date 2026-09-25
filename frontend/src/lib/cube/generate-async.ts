// generateCube, off the main thread. Follows the pattern in
// lib/offline/ensure-combos.ts: a module worker, an inline fallback when
// workers are unavailable or under test, and an inline fallback when the
// worker itself errors.
//
// Staleness: a module-level generation counter drops any result that isn't
// from the most recent call (a second Build click, or a page leave, makes the
// previous call's eventual result a no-op) — the app only ever has one cube
// build in flight at a time. An optional AbortSignal additionally terminates
// the worker / short-circuits the inline run early, so a superseded build
// stops burning CPU instead of merely being ignored on arrival.

import { generateCube, type CubeGenOptions, type GeneratedCube } from './generate';
import type { CubeCard } from './core';
import type { CubeSize } from './targets';
import type { CubeProgress, CubeWorkerResponse } from './generate-async-types';
import { logger } from '../logger';

export type { CubeProgress };

export interface GenerateCubeAsyncHandlers {
  onProgress?: (progress: CubeProgress) => void;
  signal?: AbortSignal;
}

let currentGen = 0;

const abortError = () => new DOMException('Superseded by a newer build', 'AbortError');

export function generateCubeAsync(
  pool: CubeCard[],
  size: CubeSize,
  options?: CubeGenOptions,
  { onProgress, signal }: GenerateCubeAsyncHandlers = {}
): Promise<GeneratedCube> {
  const gen = ++currentGen;
  const stale = () => gen !== currentGen || Boolean(signal?.aborted);

  if (typeof Worker === 'undefined' || import.meta.env.MODE === 'test') {
    return runInline(pool, size, options, onProgress, stale);
  }
  return runWorker(pool, size, options, onProgress, signal, stale);
}

/** Deferred to a microtask so a second call made before the first's work runs
 *  can still supersede it (see the staleness test). */
function runInline(
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

function runWorker(
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
      worker = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      runInline(pool, size, options, onProgress, stale).then(resolve, reject);
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
      } else {
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      logger.warn('[cube] generate worker crashed:', e.message);
      finish();
      runInline(pool, size, options, onProgress, stale).then(resolve, reject);
    };
    // Strip onProgress before it crosses the postMessage boundary — a
    // function isn't structured-cloneable, and progress goes through the
    // worker's own message channel instead.
    const { onProgress: _dropped, ...wireOptions } = options ?? {};
    worker.postMessage({ pool, size, options: wireOptions });
  });
}
