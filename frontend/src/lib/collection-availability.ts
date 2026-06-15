import type { Deck } from '../store/decks';
import type { EnrichedCard } from '../types';
import { buildAllocationMap } from './allocations';

export interface AvailableCollection {
  names: Set<string>;
  counts: Map<string, number>;
}

export function buildAvailableCollection(
  collection: EnrichedCard[],
  decks: Deck[]
): AvailableCollection {
  const claimed = buildAllocationMap(decks);
  const names = new Set<string>();
  const counts = new Map<string, number>();

  for (const card of collection) {
    if (claimed.has(card.copyId)) continue;
    names.add(card.name);
    counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  }

  return { names, counts };
}
