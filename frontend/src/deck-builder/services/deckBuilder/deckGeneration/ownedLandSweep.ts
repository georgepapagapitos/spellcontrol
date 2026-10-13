import { logger } from '@/lib/util/logger';
import type { ScryfallCard } from '@/deck-builder/types';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { notInCollection } from '../deckFilters';
import type { GenerationState } from './state';
import { addBasicLands, type LandTopUpContext } from './landTopUp';

/**
 * Last line for every land path: an owned-only build ships no land outside the
 * collection unless the report names it as a relaxation. A late phase that
 * seated one (the coherence repair's spare refill gave an "available only"
 * Zo-Zu build Sokenzan and Memorial to War) loses it here to an owned spare,
 * else a basic. Returns the names it took out.
 */
export async function sweepUnownedLands(
  state: Pick<GenerationState, 'categories' | 'usedNames'>,
  collectionNames: ReadonlySet<string> | undefined,
  relaxedNames: ReadonlySet<string>,
  landSpares: readonly ScryfallCard[],
  topUp: LandTopUpContext
): Promise<string[]> {
  if (!collectionNames) return [];
  const owned = collectionNames as Set<string>;
  const removed: string[] = [];
  let basicsOwed = 0;
  state.categories.lands = state.categories.lands.flatMap((land) => {
    if (
      land.isMustInclude ||
      getFrontFaceTypeLine(land).toLowerCase().includes('basic') ||
      relaxedNames.has(land.name) ||
      !notInCollection(land.name, owned)
    ) {
      return [land];
    }
    logger.warn(`[DeckGen] Unowned land ${land.name} left an owned-only build`);
    removed.push(land.name);
    state.usedNames.delete(land.name);
    const spare = landSpares.find(
      (s) => !state.usedNames.has(s.name) && !notInCollection(s.name, owned)
    );
    if (spare) {
      state.usedNames.add(spare.name);
      return [spare];
    }
    basicsOwed++;
    return [];
  });
  await addBasicLands({ ...topUp, categories: state.categories }, basicsOwed);
  return removed;
}
