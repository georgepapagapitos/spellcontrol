import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '@/store/decks';

// The deck page's Coach rescans every deck the user owns after each edit. It
// re-analysed the synergy of every sibling deck each time, though an edit
// replaces only the deck it touched: about 80 ms per edit at 4x CPU on 12
// decks, and more with every deck the user adds (E1049). A deck object's
// profile is computed once.

const analyzeDeckSynergy = vi.hoisted(() => vi.fn());
vi.mock('@/deck-builder/services/synergy/deckSynergy', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/deck-builder/services/synergy/deckSynergy')>();
  analyzeDeckSynergy.mockImplementation(real.analyzeDeckSynergy);
  return { ...real, analyzeDeckSynergy };
});

import { findCrossDeckMoves } from './cross-deck-moves';

const card = (name: string) =>
  ({
    id: name,
    oracle_id: `o-${name}`,
    name,
    cmc: 2,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    prices: {},
    legalities: { commander: 'legal' },
  }) as unknown as ScryfallCard;

const deck = (id: string, names: string[]) =>
  ({
    id,
    name: id,
    format: 'commander',
    commander: null,
    partnerCommander: null,
    cards: names.map((n) => ({ slotId: `${id}-${n}`, card: card(n), allocatedCopyId: null })),
    sideboard: [],
  }) as unknown as Deck;

describe('findCrossDeckMoves deck profiles', () => {
  it('analyses each deck object once, and only the edited deck again', () => {
    const a = deck('a', ['Sol Ring']);
    const b = deck('b', ['Arcane Signet']);
    const c = deck('c', ['Mind Stone']);
    findCrossDeckMoves([a, b, c], [], new Map());
    expect(analyzeDeckSynergy).toHaveBeenCalledTimes(3);

    // An edit replaces deck b; a and c are the same objects as before.
    const edited = { ...b, cards: [...b.cards] } as Deck;
    findCrossDeckMoves([a, edited, c], [], new Map());
    expect(analyzeDeckSynergy).toHaveBeenCalledTimes(4);
  });
});
