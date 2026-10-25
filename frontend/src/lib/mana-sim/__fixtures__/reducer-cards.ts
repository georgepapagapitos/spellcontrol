/** Real Scryfall records for the cost reducer tests (`reducers.fixture.json`). */

import type { ScryfallCard } from '@/deck-builder/types';
import fixture from './reducers.fixture.json';

const byName = new Map<string, ScryfallCard>(
  (fixture.cards as unknown as ScryfallCard[]).map((c) => [c.name, c])
);

export function reducerCard(name: string): ScryfallCard {
  const hit = byName.get(name);
  if (!hit) throw new Error(`no reducer fixture card named ${name}`);
  return hit;
}
