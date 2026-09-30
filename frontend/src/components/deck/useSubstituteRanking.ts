import { useEffect, useSyncExternalStore } from 'react';
import {
  prepareSubstituteRanking,
  subscribeSubstituteRanking,
  substituteRankingReady,
} from '@/deck-builder/services/substitutes';

/**
 * Whether substitute ranking v2 (E517) can rank. `load` starts fetching the
 * card facts it reads; pass it only where a suggestion surface is on screen
 * (the Coach tab), so a visit that never opens one never downloads them.
 * Every subscriber re-renders when the facts land, whichever surface asked.
 */
export function useSubstituteRanking(load: boolean): boolean {
  const ready = useSyncExternalStore(
    subscribeSubstituteRanking,
    substituteRankingReady,
    substituteRankingReady
  );
  useEffect(() => {
    if (load && !ready) void prepareSubstituteRanking();
  }, [load, ready]);
  return ready;
}
