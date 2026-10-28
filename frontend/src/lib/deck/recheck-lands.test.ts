import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Customization, ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import type { Deck } from '@/store/decks';

const generateDeck = vi.fn();
vi.mock('@/deck-builder/services/deckBuilder/deckGenerator', () => ({
  generateDeck: (...a: unknown[]) => generateDeck(...a),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getFrontFaceTypeLine: (c: ScryfallCard) => c.type_line ?? '',
}));

import {
  canRecheckLands,
  generatedListAfter,
  landSwapKey,
  landSwapSteps,
  pairLandSwaps,
  recheckLands,
} from './recheck-lands';

const land = (name: string, basic = false): ScryfallCard =>
  ({
    id: `sf-${name}`,
    name,
    type_line: basic ? `Basic Land — ${name}` : 'Land',
    color_identity: [],
  }) as unknown as ScryfallCard;
const spell = (name: string, usd?: string): ScryfallCard =>
  ({
    id: `sf-${name}`,
    name,
    type_line: 'Instant',
    color_identity: ['U'],
    prices: usd ? { usd } : {},
  }) as unknown as ScryfallCard;
const names = (cards: ScryfallCard[]) => cards.map((c) => c.name);

function deck(
  cards: ScryfallCard[],
  customization: Partial<Customization> = {},
  generated: string[] = names(cards).filter((n) => n !== 'Island')
): Deck {
  return {
    id: 'd1',
    name: 'Talrand',
    source: 'generated',
    format: 'commander',
    commander: {
      name: 'Talrand, Sky Summoner',
      color_identity: ['U'],
      type_line: 'Legendary Creature — Merfolk Wizard',
    } as unknown as ScryfallCard,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: cards.map((card, i) => ({ slotId: `s${i}`, card, allocatedCopyId: null })),
    sideboard: [],
    considering: [],
    generationContext: {
      selectedThemes: [],
      targetBracket: 3,
      landCount: 4,
      collectionMode: true,
      customization: {
        collectionMode: true,
        collectionStrategy: 'full',
        nonBasicLandCount: 2,
        targetBracket: 3,
        ...customization,
      },
      generatedList: { cards: generated, commanders: ['Talrand, Sky Summoner'] },
    },
    color: '#4a6a8a',
    createdAt: 0,
    updatedAt: 0,
  } as Deck;
}

const owned = (...n: string[]) =>
  n.map((name, i) => ({ copyId: `c${i}`, name }) as unknown as EnrichedCard);

/** A generator result: the pinned spells back, plus these lands. */
function built(lands: ScryfallCard[], extra: Record<string, unknown> = {}) {
  generateDeck.mockImplementation(async (ctx: { optimizeDeckCards: string[] }) => ({
    categories: {
      spells: ctx.optimizeDeckCards
        .map((n) => spell(n))
        .filter((c) => !lands.some((l) => l.name === c.name)),
      lands,
    },
    dataSource: 'base+bracket',
    cardInclusionMap: { 'Mystic Sanctuary': 41 },
    ...extra,
  }));
}

beforeEach(() => {
  generateDeck.mockReset();
});

describe('pairLandSwaps', () => {
  it('drops unchanged copies and pairs nonbasics before basics', () => {
    const current = [
      land('Island', true),
      land('Island', true),
      land('Halimar Depths'),
      land('Evolving Wilds'),
    ];
    const next = [
      land('Island', true),
      land('Mystic Sanctuary'),
      land('Swamp', true),
      land('Evolving Wilds'),
    ];
    const swaps = pairLandSwaps(current, next);
    expect(swaps.map((s) => [s.out.name, s.in.name])).toEqual([
      ['Halimar Depths', 'Mystic Sanctuary'],
      ['Island', 'Swamp'],
    ]);
  });

  it('leaves the deck alone when the picks match, in any order', () => {
    const current = [land('Island', true), land('Mystic Sanctuary')];
    expect(pairLandSwaps(current, [...current].reverse())).toEqual([]);
  });

  it('never cuts a land it has nothing to replace with', () => {
    const swaps = pairLandSwaps([land('A'), land('B')], [land('C')]);
    expect(swaps).toHaveLength(1);
  });
});

describe('canRecheckLands', () => {
  const lands = [land('Island', true)];
  it('needs a deck generated from the collection by the EDHREC pipeline', () => {
    expect(canRecheckLands(deck(lands))).toBe(true);
    expect(canRecheckLands({ ...deck(lands), source: 'manual' })).toBe(false);
    expect(canRecheckLands(deck(lands, { collectionMode: false }))).toBe(false);
    expect(canRecheckLands(deck(lands, { collectionStrategy: 'exclude' }))).toBe(false);
    expect(canRecheckLands(deck(lands, { generationMode: 'oracle-role' }))).toBe(false);
    expect(canRecheckLands(deck(lands, { mtgFormat: 'paupercommander' }))).toBe(false);
  });
});

describe('generatedListAfter', () => {
  it('records the swapped-in nonbasics as the build’s own picks', () => {
    const d = deck([land('Halimar Depths'), land('Island', true)]);
    const gc = generatedListAfter(d, [
      { cutName: 'Halimar Depths', addName: 'Mystic Sanctuary' },
      { cutName: 'Island', addName: 'Swamp' },
    ]);
    expect(gc?.generatedList?.cards).toEqual(['Mystic Sanctuary']);
  });
});

// E1034: seen live, Otawara -> Mana Confluence came back on every re-check
// after the player unchecked it and applied the rest.
describe('declined swaps', () => {
  it('remembers the unchecked swaps on apply, and forgets one the player later takes', () => {
    const d = deck([land('Otawara, Soaring City'), land('Halimar Depths')]);
    const gc = generatedListAfter(
      d,
      [{ cutName: 'Halimar Depths', addName: 'Mystic Sanctuary' }],
      [{ out: land('Otawara, Soaring City'), in: land('Mana Confluence') }]
    );
    expect(gc?.declinedLandSwaps).toEqual(['Otawara, Soaring City>Mana Confluence']);
    const later = generatedListAfter({ generationContext: gc }, [
      { cutName: 'Otawara, Soaring City', addName: 'Mana Confluence' },
    ]);
    expect(later?.declinedLandSwaps).toBeUndefined();
  });

  it('hides a declined swap from the next re-check and returns it as hidden', async () => {
    const d = deck([spell('Ponder'), land('Otawara, Soaring City'), land('Halimar Depths')]);
    d.generationContext!.declinedLandSwaps = ['Otawara, Soaring City>Mana Confluence'];
    built([land('Mana Confluence'), land('Mystic Sanctuary')]);
    const result = await recheckLands(d, {
      collection: owned('Mana Confluence', 'Mystic Sanctuary'),
      decks: [d],
      cubes: [],
    });
    expect(result.swaps.map((s) => [s.out.name, s.in.name])).toEqual([
      ['Halimar Depths', 'Mystic Sanctuary'],
    ]);
    expect(result.hidden.map(landSwapKey)).toEqual(['Otawara, Soaring City>Mana Confluence']);
  });
});

describe('recheckLands', () => {
  it('rebuilds with the saved settings and every spell pinned, then keeps only the lands', async () => {
    const d = deck(
      [spell('Ponder'), land('Halimar Depths'), land('Island', true), land('Island', true)],
      { deckBudget: 50, maxRarity: 'rare', targetBracket: 2, nonBasicLandCount: 1 }
    );
    built([land('Mystic Sanctuary'), land('Island', true), land('Island', true)]);
    const result = await recheckLands(d, {
      collection: owned('Mystic Sanctuary', 'Island'),
      decks: [d],
      cubes: [],
      bannedCards: ['Gaea’s Cradle'],
    });

    expect(result.swaps.map((s) => [s.out.name, s.in.name])).toEqual([
      ['Halimar Depths', 'Mystic Sanctuary'],
    ]);
    expect(result.inclusion['Mystic Sanctuary']).toBe(41);
    const ctx = generateDeck.mock.calls[0][0];
    expect(ctx.optimizeDeckCards).toEqual(['Ponder']);
    expect(ctx.colorIdentity).toEqual(['U']);
    expect(ctx.customization).toMatchObject({
      deckBudget: 50,
      maxRarity: 'rare',
      targetBracket: 2,
      nonBasicLandCount: 1,
      collectionMode: true,
      collectionStrategy: 'full',
      landCount: 3, // the deck's own, held
      landsExplicit: true,
      bannedCards: ['Gaea’s Cradle'],
      mustIncludeCards: [],
    });
    expect([...ctx.collectionNames]).toEqual(['Mystic Sanctuary', 'Island']);
    expect(ctx.collectionPool.map((c: { name: string }) => c.name)).toEqual([
      'Mystic Sanctuary',
      'Island',
    ]);
  });

  it('keeps lands the player added and bans what they cut', async () => {
    const d = deck([land('Reliquary Tower'), land('Halimar Depths'), land('Island', true)], {}, [
      'Halimar Depths',
      'Cavern of Souls',
    ]);
    built([land('Reliquary Tower'), land('Halimar Depths'), land('Island', true)]);
    const result = await recheckLands(d, { collection: [], decks: [d], cubes: [] });

    expect(result.kept).toEqual(['Reliquary Tower']);
    expect(result.swaps).toEqual([]);
    const ctx = generateDeck.mock.calls[0][0];
    expect(ctx.optimizeDeckCards).toEqual(['Reliquary Tower']);
    expect(ctx.customization.tempBannedCards).toEqual(['Cavern of Souls']);
  });

  it('counts this deck’s own copies as free under “available only”', async () => {
    const d = deck([land('Halimar Depths')], { collectionStrategy: 'available' });
    const other = { ...deck([land('Mystic Sanctuary')]), id: 'd2' };
    other.cards[0].allocatedCopyId = 'c1';
    d.cards[0].allocatedCopyId = 'c0';
    built([land('Halimar Depths')]);
    await recheckLands(d, {
      collection: owned('Halimar Depths', 'Mystic Sanctuary'),
      decks: [d, other],
      cubes: [],
    });
    const ctx = generateDeck.mock.calls[0][0];
    expect([...ctx.collectionNames]).toEqual(['Halimar Depths']);
    expect(ctx.collectionAvailableCounts.get('Halimar Depths')).toBe(1);
  });

  it('says so when the commander’s EDHREC page won’t load', async () => {
    built([land('Island', true)], { dataSource: 'scryfall' });
    const d = deck([land('Island', true)]);
    await expect(recheckLands(d, { collection: [], decks: [d], cubes: [] })).rejects.toThrow(
      /Couldn't load land picks/
    );
  });

  it('refuses a deck with nothing to replay', async () => {
    const d = { ...deck([land('Island', true)]), source: 'manual' as const };
    await expect(recheckLands(d, { collection: [], decks: [d], cubes: [] })).rejects.toThrow();
    expect(generateDeck).not.toHaveBeenCalled();
  });

  it('turns the swaps into plan steps', () => {
    expect(landSwapSteps([{ out: land('A'), in: land('B') }])).toEqual([
      { cutName: 'A', addName: 'B' },
    ]);
  });
});
