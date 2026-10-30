import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ProductPhysicalCard } from '@/types/index';
import {
  groupPhysicalByZone,
  physicalCardsToUploadResponse,
  productBoxExtras,
  productCommanderFinish,
  zoneBreakdown,
  zoneLabel,
} from './product-import';

function card(name: string, id: string): ScryfallCard {
  return { id, name } as unknown as ScryfallCard;
}

const physical: ProductPhysicalCard[] = [
  { card: card('Zada, Hedron Grinder', 'zada'), quantity: 1, finish: 'foil', zone: 'commander' },
  { card: card('Sol Ring', 'sol'), quantity: 1, finish: 'nonfoil', zone: 'mainBoard' },
  { card: card('Mountain', 'mtn'), quantity: 22, finish: 'foil', zone: 'mainBoard' },
  {
    card: card('Zada (etched)', 'zada-e'),
    quantity: 1,
    finish: 'etched',
    zone: 'displayCommander',
  },
  { card: card('Goblin', 'gob'), quantity: 2, finish: 'nonfoil', zone: 'tokens' },
];

describe('physicalCardsToUploadResponse', () => {
  it('expands every physical card to one owned copy per quantity, preserving finish', () => {
    const resp = physicalCardsToUploadResponse(physical);
    // 1 + 1 + 22 + 1 + 2 = 27 physical copies.
    expect(resp.cards).toHaveLength(27);
    expect(resp.totalRows).toBe(27);

    // Each copy is distinct (unique copyId) so quantities aren't collapsed.
    expect(new Set(resp.cards.map((c) => c.copyId)).size).toBe(27);

    // Finishes are preserved per copy.
    const mountains = resp.cards.filter((c) => c.name === 'Mountain');
    expect(mountains).toHaveLength(22);
    expect(mountains.every((c) => c.finish === 'foil' && c.foil)).toBe(true);
    expect(resp.cards.find((c) => c.name === 'Zada (etched)')?.finish).toBe('etched');
  });
});

describe('zoneBreakdown', () => {
  it('groups copies by zone in deck-first display order', () => {
    const breakdown = zoneBreakdown(physical);
    expect(breakdown.map((b) => b.zone)).toEqual([
      'commander',
      'mainBoard',
      'displayCommander',
      'tokens',
    ]);
    expect(breakdown.find((b) => b.zone === 'mainBoard')?.count).toBe(23); // Sol Ring + 22 Mountain
    expect(breakdown.find((b) => b.zone === 'displayCommander')?.label).toBe('Display commander');
    expect(breakdown.find((b) => b.zone === 'tokens')?.count).toBe(2);
  });
});

describe('groupPhysicalByZone', () => {
  it('groups cards by zone in deck-first order with copy counts and the cards', () => {
    const groups = groupPhysicalByZone(physical);
    expect(groups.map((g) => g.zone)).toEqual([
      'commander',
      'mainBoard',
      'displayCommander',
      'tokens',
    ]);
    const deck = groups.find((g) => g.zone === 'mainBoard')!;
    expect(deck.label).toBe('Deck');
    expect(deck.count).toBe(23); // Sol Ring + 22 Mountain
    expect(deck.cards.map((c) => c.card.name)).toEqual(['Sol Ring', 'Mountain']);
    expect(groups.find((g) => g.zone === 'displayCommander')?.cards).toHaveLength(1);
  });
});

describe('zoneLabel', () => {
  it('falls back to the raw zone name for unknown zones', () => {
    expect(zoneLabel('mainBoard')).toBe('Deck');
    expect(zoneLabel('bonusCards')).toBe('bonusCards');
  });
});

describe('productBoxExtras', () => {
  it('keeps the box cards outside the playable deck, without tokens, one per copy', () => {
    const extras = productBoxExtras([
      ...physical,
      {
        card: card('Sol Ring (alt art)', 'sol-alt'),
        quantity: 2,
        finish: 'foil',
        zone: 'sideBoard',
      },
    ]);
    expect(extras.map((e) => [e.card.name, e.finish])).toEqual([
      ['Zada (etched)', 'etched'],
      ['Sol Ring (alt art)', 'foil'],
      ['Sol Ring (alt art)', 'foil'],
    ]);
  });

  it('drops a token-layout card in any zone', () => {
    const emblem = { ...card('Emblem', 'emb'), layout: 'emblem' } as ScryfallCard;
    expect(
      productBoxExtras([{ card: emblem, quantity: 1, finish: 'nonfoil', zone: 'sideBoard' }])
    ).toEqual([]);
  });

  it('is empty for a box that is only the deck', () => {
    expect(productBoxExtras(physical.filter((pc) => pc.zone !== 'displayCommander'))).toEqual([]);
  });
});

describe('productCommanderFinish', () => {
  it("reads the command-zone copy's finish, not a display copy's", () => {
    const sameprinting: ProductPhysicalCard[] = [
      { card: card('Zada', 'zada'), quantity: 1, finish: 'foil', zone: 'commander' },
      { card: card('Zada', 'zada'), quantity: 1, finish: 'etched', zone: 'displayCommander' },
    ];
    expect(productCommanderFinish(sameprinting, 'zada')).toBe('foil');
    expect(productCommanderFinish(sameprinting, 'missing')).toBeUndefined();
    expect(productCommanderFinish(sameprinting, undefined)).toBeUndefined();
  });
});
