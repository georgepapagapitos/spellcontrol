/**
 * The game-state reducer now lives in the shared, zero-dependency package
 * `@spellcontrol/game-core` and is the single source of truth for both the
 * frontend (local + optimistic play) and the authoritative backend (online
 * sessions).
 *
 * This module is a thin re-export kept only so existing imports
 * (`@/lib/game-state`) stay stable. Do NOT add reducer logic here — edit
 * `packages/game-core/src/index.ts` instead. There is no longer a second
 * copy to keep in lockstep; the historical drift hazard is gone by
 * construction (which is why the old hand-mirrored parity test was removed).
 */
export * from '@spellcontrol/game-core';
