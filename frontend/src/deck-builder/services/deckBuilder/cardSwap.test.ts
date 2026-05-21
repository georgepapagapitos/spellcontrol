import { describe, it, expect } from 'vitest';
import { getCategoryForCard, swapCard, getSwapCandidatesForCard } from './cardSwap';
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
