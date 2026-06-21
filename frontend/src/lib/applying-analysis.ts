/**
 * Shared "applying analysis state" flag.
 *
 * Mirrors the `applying-server.ts` pattern exactly. Lives in its own
 * zero-dependency module so the decks-store subscriber can read it
 * **synchronously** — before the async `import('./sync')` — without importing
 * sync.ts (which imports the stores back, creating a cycle).
 *
 * Set this flag around any derived/background analysis write to the decks
 * store (e.g. use-commander-bracket-analysis) so the subscriber skips
 * enqueueing those changes into the sync mutation queue. The analysis is
 * re-derived data: losing it on a cache miss is acceptable, and pushing it to
 * the server on every deck open is wasteful.
 */
import { makeFlag } from './make-flag';

const { get, set } = makeFlag();

/** Decks subscriber checks this synchronously to skip persisting analysis writes. */
export function isApplyingAnalysis(): boolean {
  return get();
}

export function setApplyingAnalysis(value: boolean): void {
  set(value);
}
