import type { SideCounts } from './sync-merge';

/**
 * Cross-layer bridge for the "guest has local data → signs into an account
 * that also has data" prompt. sync.ts is framework-agnostic and can't open a
 * React modal directly, so the dialog component registers an async handler at
 * mount that resolves with the user's choice.
 *
 * The contract is intentionally tiny:
 *   - Exactly one handler at a time. A second register replaces the first.
 *   - If no handler is registered when a collision happens, we resolve to
 *     `'keep-server'` — the historical (silent-overwrite) behavior, but now
 *     a logged warning. The intent is that the dialog is mounted as part of
 *     the root layout, so this fallback only fires in test setups that forget
 *     to mock it.
 */

export type CollisionChoice = 'keep-server' | 'keep-local' | 'merge';

export interface CollisionInfo {
  /** Counts from the local side (guest data on this device). */
  local: SideCounts;
  /** Counts from the server side (data already on the account). */
  server: SideCounts;
  /** Username being signed into, for the modal copy. */
  accountLabel: string;
}

export type CollisionHandler = (info: CollisionInfo) => Promise<CollisionChoice>;

let registered: CollisionHandler | null = null;

export function registerCollisionHandler(handler: CollisionHandler | null): () => void {
  registered = handler;
  return () => {
    if (registered === handler) registered = null;
  };
}

export async function invokeCollisionHandler(info: CollisionInfo): Promise<CollisionChoice> {
  if (!registered) return 'keep-server';
  try {
    return await registered(info);
  } catch {
    // A throwing handler must not corrupt sync — fall back to the safest
    // choice (keep server) so we never overwrite the server with stale
    // local data because a modal crashed.
    return 'keep-server';
  }
}

/** Test helper: returns true if a handler is currently registered. */
export function hasCollisionHandler(): boolean {
  return registered !== null;
}
