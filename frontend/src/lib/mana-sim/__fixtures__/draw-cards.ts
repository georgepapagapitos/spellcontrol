/** Real Scryfall records for the draw and goal tests (`draw.fixture.json`). */

import type { ScryfallCard } from '@/deck-builder/types';
import fixture from './draw.fixture.json';

const byName = new Map<string, ScryfallCard>(
  (fixture.cards as unknown as ScryfallCard[]).map((c) => [c.name, c])
);

export function drawCard(name: string): ScryfallCard {
  const hit = byName.get(name);
  if (!hit) throw new Error(`no draw fixture card named ${name}`);
  return hit;
}
