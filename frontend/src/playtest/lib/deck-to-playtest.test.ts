/**
 * The table deals the printing you own. A deck slot allocated to a copy in
 * your collection shows that copy's printing in the deck view
 * (deck-display-rows), so the playtest must show the same one, not whichever
 * printing the slot happened to be added as (user feedback, 2026-09-23).
 */
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import type { EnrichedCard } from '@/types';
import { deckToPlaytestInit } from './deck-to-playtest';

function printing(id: string, name: string, image: string): ScryfallCard {
  return {
    id,
    name,
    oracle_id: `o-${name}`,
    image_uris: { normal: image },
    type_line: 'Artifact',
  } as unknown as ScryfallCard;
}

function owned(copyId: string, image: string): EnrichedCard {
  return {
    copyId,
    name: 'Sol Ring',
    setCode: 'SLD',
    setName: 'Secret Lair Drop',
    collectorNumber: '1011',
    rarity: 'uncommon',
    scryfallId: 'sf-sld',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    imageNormal: image,
  };
}

function deck(cards: DeckCard[], extra: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Deck',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards,
    sideboard: [],
    considering: [],
    format: 'commander',
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

const slot = (slotId: string, card: ScryfallCard, allocatedCopyId: string | null): DeckCard => ({
  slotId,
  card,
  allocatedCopyId,
});

describe('deckToPlaytestInit — printings', () => {
  const cmr = printing('sf-cmr', 'Sol Ring', 'https://img/sol-cmr.jpg');
  const collectionById = new Map([['copy-1', owned('copy-1', 'https://img/sol-sld.jpg')]]);

  it('deals an allocated slot as the printing you own', () => {
    const init = deckToPlaytestInit(deck([slot('s1', cmr, 'copy-1')]), { collectionById });
    expect(init.library[0].imageUrl).toBe('https://img/sol-sld.jpg');
  });

  it('keeps the slot’s own printing when nothing is allocated, or the copy is gone', () => {
    const init = deckToPlaytestInit(
      deck([slot('s1', cmr, null), slot('s2', cmr, 'copy-deleted')]),
      { collectionById }
    );
    expect(init.library.map((c) => c.imageUrl)).toEqual([
      'https://img/sol-cmr.jpg',
      'https://img/sol-cmr.jpg',
    ]);
  });

  it('deals the commander as the printing you own too', () => {
    const atraxa = printing('sf-atraxa', 'Atraxa', 'https://img/atraxa-2016.jpg');
    const init = deckToPlaytestInit(
      deck([], { commander: atraxa, commanderAllocatedCopyId: 'copy-1' }),
      { collectionById }
    );
    expect(init.command?.[0]?.imageUrl).toBe('https://img/sol-sld.jpg');
  });

  it('uses the slot’s printing when no collection is passed (a shared deck)', () => {
    const init = deckToPlaytestInit(deck([slot('s1', cmr, 'copy-1')]));
    expect(init.library[0].imageUrl).toBe('https://img/sol-cmr.jpg');
  });
});

/** Karn, Wishes, Learn and companions fetch from outside the game, so the
 *  deck's sideboard comes to the table (user request, 2026-09-23). */
describe('deckToPlaytestInit — outside the game', () => {
  const karnTarget = printing('sf-lattice', 'Mycosynth Lattice', 'https://img/lattice.jpg');
  const idea = printing('sf-idea', 'Grasp of Darkness', 'https://img/grasp.jpg');

  it('deals the sideboard, and never the considering shortlist', () => {
    const init = deckToPlaytestInit(
      deck([], {
        sideboard: [slot('sb1', karnTarget, null)],
        considering: [slot('c1', idea, null)],
      })
    );
    expect(init.sideboard).toEqual([
      expect.objectContaining({ id: 'sb-sb1', name: 'Mycosynth Lattice', origin: 'sideboard' }),
    ]);
    expect(init.library).toEqual([]);
  });

  it('marks commanders so a reset returns them to the command zone', () => {
    const cmdr = printing('sf-karn', 'Karn, the Great Creator', 'https://img/karn.jpg');
    const init = deckToPlaytestInit(deck([], { commander: cmdr }));
    expect(init.command?.[0].origin).toBe('command');
  });
});
