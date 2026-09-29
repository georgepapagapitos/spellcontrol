import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCategoryForCard, swapCard, getSwapCandidatesForCard } from './cardSwap';
import { computeRoleCounts } from './commanderDeckAnalysis';
import { stampRoleSubtypes } from './categorize';
import { loadTaggerData, validateCardRole } from '@/deck-builder/services/tagger/client';
import type { ScryfallCard, GeneratedDeck } from '@/deck-builder/types';

function card(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return { name, id: name, type_line: 'Creature — Elf', cmc: 2, ...overrides } as ScryfallCard;
}

function emptyCategories(): GeneratedDeck['categories'] {
  return {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
  };
}

function deck(overrides: Partial<GeneratedDeck> = {}): GeneratedDeck {
  return {
    commander: null,
    partnerCommander: null,
    categories: emptyCategories(),
    stats: {
      totalCards: 0,
      averageCmc: 0,
      manaCurve: {},
      colorDistribution: {},
      typeDistribution: {},
    },
    ...overrides,
  };
}

describe('getCategoryForCard', () => {
  it('routes lands to the lands category', () => {
    expect(getCategoryForCard(card('Plains', { type_line: 'Basic Land — Plains' }))).toBe('lands');
  });

  it('routes creatures to the creatures category', () => {
    expect(getCategoryForCard(card('Bear', { type_line: 'Creature — Bear' }))).toBe('creatures');
  });

  it('routes planeswalkers to utility', () => {
    expect(
      getCategoryForCard(card('Teferi', { type_line: 'Legendary Planeswalker — Teferi' }))
    ).toBe('utility');
  });

  it('routes anything else to synergy', () => {
    expect(getCategoryForCard(card('Opt', { type_line: 'Instant' }))).toBe('synergy');
  });
});

describe('swapCard', () => {
  it('fails when the old card is not in the deck', () => {
    const result = swapCard(deck(), card('Ghost'), card('New'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('moves a card between categories and recalculates stats', () => {
    const cats = emptyCategories();
    cats.creatures = [card('Old Elf', { type_line: 'Creature — Elf' })];
    const result = swapCard(
      deck({ categories: cats }),
      card('Old Elf', { type_line: 'Creature — Elf' }),
      card('New Goblin', { type_line: 'Creature — Goblin' })
    );
    expect(result.success).toBe(true);
    expect(result.deck.categories.creatures.map((c) => c.name)).toEqual(['New Goblin']);
    expect(result.deck.stats.totalCards).toBe(1);
  });

  it('drops the swapped-in card from the swap-candidate pools', () => {
    const cats = emptyCategories();
    cats.creatures = [card('Old Elf')];
    const newGoblin = card('New Goblin', { type_line: 'Creature — Goblin' });
    const result = swapCard(
      deck({
        categories: cats,
        swapCandidates: { 'type:creature': [newGoblin, card('Other')] },
      }),
      card('Old Elf'),
      newGoblin
    );
    const pool = result.deck.swapCandidates!['type:creature'].map((c) => c.name);
    expect(pool).not.toContain('New Goblin');
    expect(pool).toContain('Other');
  });

  it('recomputes the deck score from the inclusion map', () => {
    const cats = emptyCategories();
    cats.creatures = [card('Old Elf')];
    const result = swapCard(
      deck({
        categories: cats,
        cardInclusionMap: { 'Old Elf': 30 },
        deckScore: 30,
        gapAnalysis: [
          {
            name: 'New Goblin',
            inclusion: 50,
            price: null,
            synergy: 0,
            typeLine: 'Creature — Goblin',
          },
        ],
      }),
      card('Old Elf'),
      card('New Goblin', { type_line: 'Creature — Goblin' })
    );
    // 30 - 30 (old) + 50 (new) = 50
    expect(result.deck.deckScore).toBe(50);
    expect(result.deck.cardInclusionMap!['New Goblin']).toBe(50);
    expect(result.deck.cardInclusionMap!['Old Elf']).toBeUndefined();
  });

  it('re-estimates the bracket when game-changer names are cached', () => {
    const cats = emptyCategories();
    cats.creatures = [card('Old Elf')];
    const result = swapCard(
      deck({ categories: cats, gameChangerNames: ['Some Bomb'] }),
      card('Old Elf'),
      card('New Goblin', { type_line: 'Creature — Goblin' })
    );
    expect(result.deck.bracketEstimation).toBeDefined();
  });
});

describe('getSwapCandidatesForCard', () => {
  it('returns an empty list when the deck has no swap candidates', () => {
    expect(getSwapCandidatesForCard(deck(), card('X'))).toEqual([]);
  });

  it('returns the role bucket when it has enough candidates', () => {
    const subject = card('Subject', { deckRole: 'ramp' });
    const pool = [card('R1'), card('R2'), card('R3')];
    const result = getSwapCandidatesForCard(deck({ swapCandidates: { ramp: pool } }), subject);
    expect(result.map((c) => c.name)).toEqual(['R1', 'R2', 'R3']);
  });

  it('merges role and type buckets when the role bucket is thin', () => {
    const subject = card('Subject', { deckRole: 'ramp', type_line: 'Creature — Elf' });
    const result = getSwapCandidatesForCard(
      deck({
        swapCandidates: {
          ramp: [card('R1')],
          'type:creature': [card('R1'), card('C1')],
        },
      }),
      subject
    );
    // R1 (role) first, C1 (type) appended, R1 not duplicated.
    expect(result.map((c) => c.name)).toEqual(['R1', 'C1']);
  });

  it('never suggests the card itself or the commanders', () => {
    const subject = card('Subject', { deckRole: 'ramp' });
    const result = getSwapCandidatesForCard(
      deck({
        commander: card('Cmdr'),
        swapCandidates: { ramp: [subject, card('Cmdr'), card('Valid')] },
      }),
      subject
    );
    expect(result.map((c) => c.name)).toEqual(['Valid']);
  });
});

// E528 in post-generation swaps, over real cards and the pinned tagger
// snapshot. Generation stamps every role subtype on every pick
// (stampRoleSubtypes), and the tagger answers 'card-advantage' for any card
// outside its draw tags, so a tally of stamps counts Sol Ring as card
// advantage. After a swap the stored numbers must be the recount the deck
// page runs (computeRoleCounts over the nonland buckets).
describe('swapCard recounts roles like the deck page', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const REAL = new Map<string, ScryfallCard>(
    (
      JSON.parse(
        readFileSync(resolve(here, '__fixtures__', 'invariant-cards.fixture.json'), 'utf8')
      ) as { cards: ScryfallCard[] }
    ).cards.map((c) => [c.name, c])
  );
  /** A real card stamped the way generation seats it. */
  const seated = (name: string): ScryfallCard => {
    const c = structuredClone(REAL.get(name)!);
    const role = validateCardRole(c);
    if (role) {
      c.deckRole = role;
      stampRoleSubtypes(c);
    }
    return c;
  };

  beforeAll(async () => {
    const data = JSON.parse(
      readFileSync(resolve(here, '__fixtures__', 'tagger-tags.fixture.json'), 'utf8')
    );
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
    if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
  });
  afterAll(() => vi.unstubAllGlobals());

  it('stores the computeRoleCounts recount, not the pick-time stamps', () => {
    const cats = emptyCategories();
    cats.ramp = ['Sol Ring', 'Arcane Signet', 'Cultivate', 'Llanowar Elves'].map(seated);
    cats.cardDraw = ['Harmonize', 'Ponder'].map(seated);
    cats.singleRemoval = ['Counterspell', 'Beast Within'].map(seated);
    cats.boardWipes = ['Wrath of God'].map(seated);
    cats.lands = ['Command Tower', 'Forest'].map(seated);
    const before = deck({
      categories: cats,
      roleCounts: { ramp: 4, removal: 2, boardwipe: 1, cardDraw: 2 },
      roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
    });

    const result = swapCard(before, cats.ramp[2], seated("Kodama's Reach"));

    const nonLand = Object.entries(result.deck.categories)
      .filter(([category]) => category !== 'lands')
      .flatMap(([, cards]) => cards);
    const recount = computeRoleCounts(nonLand);
    expect(result.deck.roleCounts).toEqual(recount.roleCounts);
    expect(result.deck.rampSubtypeCounts).toEqual(recount.rampSubtypeCounts);
    expect(result.deck.removalSubtypeCounts).toEqual(recount.removalSubtypeCounts);
    expect(result.deck.boardwipeSubtypeCounts).toEqual(recount.boardwipeSubtypeCounts);
    expect(result.deck.cardDrawSubtypeCounts).toEqual(recount.cardDrawSubtypeCounts);
    // The case has teeth: the ramp cards carry a card-advantage stamp.
    const stamped = Object.values(result.deck.categories)
      .flat()
      .filter((c) => c.cardDrawSubtype === 'card-advantage').length;
    expect(recount.cardDrawSubtypeCounts['card-advantage'] ?? 0).toBeLessThan(stamped);
  });
});
