import { describe, expect, it } from 'vitest';
import { binderCoverArt } from './binder-cover';
import type { EnrichedCard, MaterializedBinder } from '../types';

const NORMAL = (n: string) => `https://cards.scryfall.io/normal/front/a/b/${n}.jpg`;
const CROP = (n: string) => `https://cards.scryfall.io/art_crop/front/a/b/${n}.jpg`;

function card(over: Partial<EnrichedCard>): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Card',
    setCode: 'abc',
    setName: 'Alpha Beta',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: 'sid-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: '',
    finish: 'nonfoil',
    foil: false,
    ...over,
  };
}

function binder(cards: EnrichedCard[], coverScryfallId?: string): MaterializedBinder {
  return {
    def: {
      id: 'b1',
      name: 'Binder',
      position: 0,
      filterGroups: [{ filter: {} }],
      sorts: [],
      pocketSize: null,
      doubleSided: false,
      fixedCapacity: null,
      color: '#123456',
      coverScryfallId,
      createdAt: 0,
      updatedAt: 0,
    },
    effectivePocketSize: 9,
    effectiveSorts: [],
    displaySorts: [],
    // Split across two sections to prove the pick spans section boundaries.
    sections: [
      { key: 'a', label: 'A', cards: cards.slice(0, 1), pages: [] },
      { key: 'b', label: 'B', cards: cards.slice(1), pages: [] },
    ],
    totalCards: cards.length,
    totalPages: 0,
    totalValue: 0,
  };
}

describe('binderCoverArt', () => {
  it('returns undefined for an empty binder', () => {
    expect(binderCoverArt(binder([]))).toBeUndefined();
  });

  it('derives an art_crop URL from the most valuable card, across sections', () => {
    const b = binder([
      card({ scryfallId: 's1', purchasePrice: 2, imageNormal: NORMAL('cheap') }),
      card({ scryfallId: 's2', purchasePrice: 50, imageNormal: NORMAL('pricey') }),
    ]);
    expect(binderCoverArt(b)).toBe(CROP('pricey'));
  });

  it('skips cards without an image', () => {
    const b = binder([
      card({ scryfallId: 's1', purchasePrice: 100 }),
      card({ scryfallId: 's2', purchasePrice: 5, imageNormal: NORMAL('imaged') }),
    ]);
    expect(binderCoverArt(b)).toBe(CROP('imaged'));
  });

  it('returns undefined when no card has an image', () => {
    expect(binderCoverArt(binder([card({ purchasePrice: 100 })]))).toBeUndefined();
  });

  it('breaks price ties toward the lower (more iconic) EDHREC rank', () => {
    const b = binder([
      card({
        scryfallId: 's1',
        purchasePrice: 10,
        edhrecRank: 9000,
        imageNormal: NORMAL('obscure'),
      }),
      card({ scryfallId: 's2', purchasePrice: 10, edhrecRank: 12, imageNormal: NORMAL('iconic') }),
    ]);
    expect(binderCoverArt(b)).toBe(CROP('iconic'));
    // A ranked card beats an unranked one at the same price.
    const c = binder([
      card({ scryfallId: 's1', purchasePrice: 10, imageNormal: NORMAL('unranked') }),
      card({ scryfallId: 's2', purchasePrice: 10, edhrecRank: 500, imageNormal: NORMAL('ranked') }),
    ]);
    expect(binderCoverArt(c)).toBe(CROP('ranked'));
  });

  it('honors the user override over the most valuable card', () => {
    const b = binder(
      [
        card({ scryfallId: 's1', purchasePrice: 100, imageNormal: NORMAL('pricey') }),
        card({ scryfallId: 's2', purchasePrice: 1, imageNormal: NORMAL('chosen') }),
      ],
      's2'
    );
    expect(binderCoverArt(b)).toBe(CROP('chosen'));
  });

  it('falls back to automatic when the override card left the binder', () => {
    const b = binder(
      [card({ scryfallId: 's1', purchasePrice: 3, imageNormal: NORMAL('auto') })],
      'gone'
    );
    expect(binderCoverArt(b)).toBe(CROP('auto'));
  });

  it('falls back to automatic when the override card has no image', () => {
    const b = binder(
      [
        card({ scryfallId: 's1', purchasePrice: 3, imageNormal: NORMAL('auto') }),
        card({ scryfallId: 's2', purchasePrice: 9 }),
      ],
      's2'
    );
    expect(binderCoverArt(b)).toBe(CROP('auto'));
  });

  it('is a no-op on URLs already pointing at art_crop', () => {
    const b = binder([card({ scryfallId: 's1', imageNormal: CROP('healed') })]);
    expect(binderCoverArt(b)).toBe(CROP('healed'));
  });
});
