// The cooperative driver of the whole-deck search (E513): the same swaps as
// optimizeDeck, with the page given room to paint and take input every few
// dozen ms of work, and progress reported as the search goes. Split from
// optimizer.ts (file-size ratchet).
import { optimizeSteps, type Beat, type OptimizeOptions, type OptimizeResult } from './optimizer';
import type { ObjectiveContext, ObjectiveDeck } from './types';
import type { ScryfallCard } from '@/deck-builder/types';

/** Lets the page paint and take input: the scheduler's own yield where there is one. */
function breathe(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
}

/** Work between breaths, in ms. */
export const SLICE_MS = 40;

/**
 * The same search, waiting for the page after every SLICE_MS of work and
 * telling `onBeat` how far along it is. Same swaps as optimizeDeck for the
 * same inputs; the time budget counts work, not the waits.
 */
export async function optimizeDeckAsync(
  seed: ObjectiveDeck,
  candidates: readonly ScryfallCard[],
  baseCtx: ObjectiveContext,
  options: OptimizeOptions = {},
  onBeat?: (beat: Beat) => void
): Promise<OptimizeResult> {
  const meter = { idle: 0 };
  const steps = optimizeSteps(seed, candidates, baseCtx, options, meter);
  let sliceStart = Date.now();
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    onBeat?.(next.value);
    if (Date.now() - sliceStart >= SLICE_MS) {
      const waited = Date.now();
      await breathe();
      meter.idle += Date.now() - waited;
      sliceStart = Date.now();
    }
  }
}
