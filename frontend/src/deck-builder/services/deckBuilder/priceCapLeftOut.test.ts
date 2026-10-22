import { describe, expect, it, vi } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { GenerationState } from './deckGeneration/state';

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCachedCard: vi.fn(() => undefined),
}));

import {
  buildPriceCapLeftOutNote,
  findPriceCapLeftOut,
  type PriceCapLeftOut,
} from './priceCapLeftOut';

const card = (name: string, usd: string | null, extra: Partial<ScryfallCard> = {}) =>
  ({
    name,
    prices: { usd },
    rarity: 'uncommon',
    cmc: 1,
    games: ['paper', 'arena'],
    legalities: { commander: 'legal' },
    ...extra,
  }) as unknown as ScryfallCard;
const ec = (name: string, inclusion: number) => ({ name, inclusion }) as EDHRECCard;

function state(
  cfg: Partial<GenerationState['cfg']>,
  opts: { colors?: string[]; collection?: string[]; page?: EDHRECCard[]; banned?: string[] } = {}
): GenerationState {
  return {
    cfg: {
      format: 99,
      mtgFormat: 'commander',
      maxCardPrice: 1,
      maxRarity: null,
      maxCmc: null,
      arenaOnly: false,
      currency: 'USD',
      ignoreOwnedBudget: false,
      ignoreOwnedRarity: false,
      collectionStrategy: 'full',
      ...cfg,
    },
    context: {
      colorIdentity: opts.colors ?? ['G', 'W'],
      collectionNames: opts.collection ? new Set(opts.collection) : undefined,
    },
    bannedCards: new Set(opts.banned ?? []),
    edhrecData: { cardlists: { allNonLand: opts.page ?? [], lands: [] } },
  } as unknown as GenerationState;
}

const POOL = new Map<string, ScryfallCard>([
  ['Sol Ring', card('Sol Ring', '1.42')],
  ['Arcane Signet', card('Arcane Signet', '0.79')],
  ['Command Tower', card('Command Tower', '0.56')],
  ['Smothering Tithe', card('Smothering Tithe', '18.50', { rarity: 'rare' })],
  ['Cheap Staple', card('Cheap Staple', '0.30')],
]);
const PAGE = [ec('Sol Ring', 91), ec('Smothering Tithe', 62), ec('Cheap Staple', 80)];
const none = () => false;

describe('findPriceCapLeftOut', () => {
  it('names an over-cap staple rock and an over-cap 40%+ page card, staples first', () => {
    const rows = findPriceCapLeftOut(state({}, { page: PAGE }), POOL, none);
    expect(rows).toEqual([
      { name: 'Sol Ring', price: 1.42, inclusion: 91, staple: true },
      { name: 'Smothering Tithe', price: 18.5, inclusion: 62, staple: false },
    ]);
  });

  it('is empty when every staple fits the cap', () => {
    expect(findPriceCapLeftOut(state({ maxCardPrice: 20 }, { page: PAGE }), POOL, none)).toEqual(
      []
    );
  });

  it('is empty with no cap', () => {
    expect(findPriceCapLeftOut(state({ maxCardPrice: null }, { page: PAGE }), POOL, none)).toEqual(
      []
    );
  });

  it('skips an owned card when owned cards skip the cap, and names it when they do not', () => {
    const owned = { page: PAGE, collection: ['Sol Ring'] };
    const exempt = findPriceCapLeftOut(state({ ignoreOwnedBudget: true }, owned), POOL, none);
    expect(exempt.map((r) => r.name)).not.toContain('Sol Ring');
    const capped = findPriceCapLeftOut(state({}, owned), POOL, none);
    expect(capped.map((r) => r.name)).toContain('Sol Ring');
  });

  it('skips a card in the deck, a banned card and one another cap rules out', () => {
    const rows = findPriceCapLeftOut(
      state({ maxRarity: 'uncommon' }, { page: PAGE, banned: ['Sol Ring'] }),
      POOL,
      (n) => n === 'Command Tower'
    );
    // Sol Ring banned; Smothering Tithe is a rare under an uncommon cap.
    expect(rows).toEqual([]);
  });

  it('skips an unowned card in an owned-only build (the unowned note names it)', () => {
    const rows = findPriceCapLeftOut(
      state({ collectionStrategy: 'available' }, { page: PAGE, collection: ['Cheap Staple'] }),
      POOL,
      none
    );
    expect(rows).toEqual([]);
  });

  it('prefers the copy the rock phase fetched, and names Command Tower at 2+ colors only', () => {
    const s = state({ maxCardPrice: 0.5 }, {});
    s.priceCappedStaples = new Map([['Sol Ring', card('Sol Ring', '2.10')]]);
    expect(findPriceCapLeftOut(s, POOL, none)).toEqual([
      { name: 'Sol Ring', price: 2.1, inclusion: undefined, staple: true },
      { name: 'Arcane Signet', price: 0.79, inclusion: undefined, staple: true },
      { name: 'Command Tower', price: 0.56, inclusion: undefined, staple: true },
    ]);
    const mono = state({ maxCardPrice: 0.5 }, { colors: ['G'] });
    expect(findPriceCapLeftOut(mono, POOL, none).map((r) => r.name)).toEqual([
      'Sol Ring',
      'Arcane Signet',
    ]);
  });

  it('skips a card with no price (the note cannot say what it costs)', () => {
    const pool = new Map([['Sol Ring', card('Sol Ring', null)]]);
    expect(findPriceCapLeftOut(state({}, { colors: ['G'] }), pool, none)).toEqual([]);
  });
});

describe('buildPriceCapLeftOutNote', () => {
  it('names one card with its price and play rate', () => {
    expect(
      buildPriceCapLeftOutNote([{ name: 'Sol Ring', price: 1.42, inclusion: 91, staple: true }], 1)
    ).toBe(
      'Left out because it costs more than your $1.00 max card price: Sol Ring ($1.42, 91%). Raise the cap or add it by hand.'
    );
  });

  it('names five and counts the rest', () => {
    const rows: PriceCapLeftOut[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, i) => ({
      name,
      price: 2 + i,
      inclusion: 90 - i,
      staple: false,
    }));
    rows.unshift({ name: 'Sol Ring', price: 1.42, staple: true });
    expect(buildPriceCapLeftOutNote(rows, 1, 'EUR')).toBe(
      'Left out because they cost more than your €1.00 max card price: Sol Ring (€1.42), A (€2.00, 90%), B (€3.00, 89%), C (€4.00, 88%), D (€5.00, 87%), and 3 more played in 40%+ of decks. Raise the cap or add them by hand.'
    );
  });

  it('is undefined when nothing was left out, or with no cap', () => {
    expect(buildPriceCapLeftOutNote([], 1)).toBeUndefined();
    expect(
      buildPriceCapLeftOutNote([{ name: 'X', price: 2, inclusion: 50, staple: false }], null)
    ).toBeUndefined();
  });
});
