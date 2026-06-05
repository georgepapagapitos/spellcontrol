import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { OptimizeCard } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import { rankReplacementCuts, primaryTypeOf, type CutCandidate } from './intelligent-cuts';

// Minimal ScryfallCard factory — only the fields the ranker reads.
function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: `o-${name}`,
    name,
    cmc: 0,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  } as ScryfallCard;
}

const slot = (c: ScryfallCard): CutCandidate => ({ slotId: `slot-${c.name}`, card: c });

function removal(name: string, reason: string, inclusion: number | null = null): OptimizeCard {
  return { name, reason, reasonCategory: 'low-inclusion', inclusion } as OptimizeCard;
}

describe('primaryTypeOf', () => {
  it('returns the core type, stripping Legendary and subtypes', () => {
    expect(primaryTypeOf(card('X', { type_line: 'Legendary Creature — God' }))).toBe('Creature');
    expect(primaryTypeOf(card('X', { type_line: 'Artifact Creature — Equipment' }))).toBe(
      'Creature'
    );
    expect(primaryTypeOf(card('X', { type_line: 'Instant' }))).toBe('Instant');
    expect(primaryTypeOf(card('X', { type_line: 'Enchantment — Aura' }))).toBe('Enchantment');
    expect(primaryTypeOf(card('X', { type_line: '' }))).toBe('');
  });

  it('reads the front face of a DFC', () => {
    const dfc = card('Front // Back', {
      type_line: '',
      card_faces: [
        { name: 'Front', type_line: 'Creature — Elf' },
        { name: 'Back', type_line: 'Land' },
      ] as ScryfallCard['card_faces'],
    });
    expect(primaryTypeOf(dfc)).toBe('Creature');
  });
});

describe('rankReplacementCuts', () => {
  const add = card('Young Pyromancer', { deckRole: 'tokens', type_line: 'Creature', cmc: 2 });

  it('ranks an optimizer-flagged, related cut above an unrelated flagged cut', () => {
    const relatedFlagged = card('Goblin Token Maker', {
      deckRole: 'tokens',
      type_line: 'Creature',
      cmc: 2,
    });
    const unrelatedFlagged = card('Roaming Throne', {
      deckRole: 'ramp',
      type_line: 'Artifact',
      cmc: 4,
    });
    const cuts = rankReplacementCuts({
      addCard: add,
      deckCards: [slot(unrelatedFlagged), slot(relatedFlagged)],
      removals: [
        removal('Roaming Throne', 'Excess Ramp', 10),
        removal('Goblin Token Maker', 'Low inclusion', 12),
      ],
    });
    expect(cuts.map((c) => c.card.name)).toEqual(['Goblin Token Maker', 'Roaming Throne']);
    expect(cuts[0].related).toBe(true);
    expect(cuts[1].related).toBe(false);
  });

  it('surfaces the optimizer real reason, not a generic label', () => {
    const flagged = card('Roaming Throne', { deckRole: 'ramp', type_line: 'Artifact', cmc: 4 });
    const [cut] = rankReplacementCuts({
      addCard: add,
      deckCards: [slot(flagged)],
      removals: [removal('Roaming Throne', 'Excess Ramp', 10)],
    });
    expect(cut.reason).toBe('Excess Ramp');
  });

  it('excludes cards that are neither flagged nor related', () => {
    const irrelevant = card('Sol Ring', { deckRole: 'ramp', type_line: 'Artifact', cmc: 1 });
    const cuts = rankReplacementCuts({ addCard: add, deckCards: [slot(irrelevant)], removals: [] });
    expect(cuts).toHaveLength(0);
  });

  it('surfaces related-but-unflagged cuts with a relation-derived reason', () => {
    const relatedCreature = card('Other Creature', {
      deckRole: 'beater',
      type_line: 'Creature',
      cmc: 3,
    });
    const [cut] = rankReplacementCuts({
      addCard: add,
      deckCards: [slot(relatedCreature)],
      removals: [],
    });
    expect(cut.card.name).toBe('Other Creature');
    expect(cut.related).toBe(true);
    expect(cut.reason).toBe('Overlapping type'); // same type (Creature), different role
  });

  it('prefers role overlap reason when roles match', () => {
    const sameRole = card('Token Buddy', { deckRole: 'tokens', type_line: 'Enchantment', cmc: 5 });
    const [cut] = rankReplacementCuts({ addCard: add, deckCards: [slot(sameRole)], removals: [] });
    expect(cut.reason).toBe('Overlapping role');
  });

  it('never offers to cut the card being added', () => {
    const dupe = card('Young Pyromancer', { deckRole: 'tokens', type_line: 'Creature', cmc: 2 });
    const cuts = rankReplacementCuts({
      addCard: add,
      deckCards: [slot(dupe)],
      removals: [removal('Young Pyromancer', 'Low inclusion', 5)],
    });
    expect(cuts).toHaveLength(0);
  });

  it('breaks ties toward the weaker (less-played) cut', () => {
    const weak = card('Weak Creature', { deckRole: 'beater', type_line: 'Creature', cmc: 2 });
    const strong = card('Strong Creature', { deckRole: 'beater', type_line: 'Creature', cmc: 2 });
    const cuts = rankReplacementCuts({
      addCard: add,
      deckCards: [slot(strong), slot(weak)],
      removals: [
        removal('Strong Creature', 'Low inclusion', 40),
        removal('Weak Creature', 'Low inclusion', 5),
      ],
    });
    expect(cuts.map((c) => c.card.name)).toEqual(['Weak Creature', 'Strong Creature']);
  });

  it('respects the limit', () => {
    const cards = Array.from({ length: 12 }, (_, i) =>
      slot(card(`C${i}`, { deckRole: 'beater', type_line: 'Creature', cmc: 2 }))
    );
    const cuts = rankReplacementCuts({ addCard: add, deckCards: cards, removals: [], limit: 5 });
    expect(cuts).toHaveLength(5);
  });
});
