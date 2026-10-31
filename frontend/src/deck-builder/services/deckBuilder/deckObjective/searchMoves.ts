// The whole-deck search's move shape, and how much of its swap list the best deck keeps.
// Split out of optimizer.ts (file-size ratchet), no behavior of its own.
import type { ScryfallCard } from '@/deck-builder/types';
import type { ObjectiveDeck } from './types';

export interface Move {
  out: number[]; // indices into the current deck
  in: ScryfallCard[];
  kind: 'improve' | 'combo';
  estimate: number;
  /** A nonbasic land for a basic: the incoming land's quality credit, which its bar is raised by. */
  landUp?: number;
}

/** How many applied swaps lead to the returned (best) deck: a prefix of all swaps. */
export function keptUpTo(
  applied: Array<{ out: ScryfallCard[]; in: ScryfallCard[] }>,
  seed: ObjectiveDeck,
  bestDeck: ObjectiveDeck
): number {
  const target = bestDeck.cards
    .map((c) => c.name)
    .sort()
    .join('|');
  let names = seed.cards.map((c) => c.name);
  if (names.slice().sort().join('|') === target) return 0;
  for (let i = 0; i < applied.length; i++) {
    for (let j = 0; j < applied[i].out.length; j++) {
      const at = names.indexOf(applied[i].out[j].name);
      names = [...names.slice(0, at), applied[i].in[j].name, ...names.slice(at + 1)];
    }
    if (names.slice().sort().join('|') === target) return i + 1;
  }
  return applied.length;
}
