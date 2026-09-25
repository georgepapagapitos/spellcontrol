import { createContext, useContext } from 'react';
import type { Rect } from '@/playtest/lib/auto-place';
import { usePlaytestStore } from '@/playtest/store';

/**
 * One shape for "do a horde thing" — solo dispatches straight to the
 * playtest store, an online table (lane F2's `PlaytestBoard`) provides a
 * value that dispatches game-core actions instead (`useOnlineHorde`'s
 * `actions`). HordeHalf/HordeBand/HordeSoloBanner/HordeOverlays call only
 * this, so their solo behaviour is unchanged when nothing is provided.
 */
export interface HordeActions {
  take(amount: number): void;
  damage(amount: number, rect: Rect | null): void;
  move(cardId: string, to: 'graveyard' | 'exile' | 'library'): void;
  confirmReveal(rect: Rect | null): void;
  clearDamageResult(): void;
  retryLoad(): void;
}

const HordeActionsContext = createContext<HordeActions | null>(null);
export const HordeActionsProvider = HordeActionsContext.Provider;

/** Stable reference (module-level, not built per render) so a consumer that
 *  puts it in a dependency array doesn't re-run every render. */
const soloHordeActions: HordeActions = {
  take: (amount) => usePlaytestStore.getState().resolveHordeAttack(amount),
  damage: (amount, rect) => usePlaytestStore.getState().damageHorde(amount, rect),
  move: (cardId, to) => usePlaytestStore.getState().moveHordeCard(cardId, to),
  confirmReveal: (rect) => usePlaytestStore.getState().confirmHordeReveal(rect),
  clearDamageResult: () => usePlaytestStore.getState().clearHordeDamageResult(),
  retryLoad: () => usePlaytestStore.getState().retryHordeLoad(),
};

/** The provided value at an online table, else the solo playtest store's
 *  actions — never null. */
export function useHordeActions(): HordeActions {
  return useContext(HordeActionsContext) ?? soloHordeActions;
}
