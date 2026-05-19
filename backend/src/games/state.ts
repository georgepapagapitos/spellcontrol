/**
 * The game-state reducer now lives in the shared, zero-dependency package
 * `@spellcontrol/game-core` and is the single source of truth for both the
 * authoritative backend (online sessions) and the frontend (local +
 * optimistic play).
 *
 * This module is a thin re-export kept only so existing imports
 * (`../games/state`) stay stable. Do NOT add reducer logic here — edit
 * `packages/game-core/src/index.ts` instead. There is no longer a second
 * copy to keep in lockstep; the historical drift hazard is gone by
 * construction.
 */
export * from '@spellcontrol/game-core';
