import { describe, it, expect } from 'vitest';
import { isLand, cardCmc, toSimCard } from './hand-classify';
import type { ScryfallCard } from '../deck-builder/types';

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-1',
    oracle_id: 'oid-1',
    name: 'Test Card',
    cmc: 2,
    type_line: 'Creature — Human Wizard',
    oracle_text: '',
    color_identity: ['U'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    legalities: { commander: 'legal' },
    prices: {},
    ...overrides,
  } as ScryfallCard;
}

describe('isLand', () => {
  it('detects lands from the type line (case-insensitive)', () => {
    expect(isLand(card({ type_line: 'Basic Land — Forest' }))).toBe(true);
    expect(isLand(card({ type_line: 'LAND' }))).toBe(true);
  });

  it('returns false for non-lands', () => {
    expect(isLand(card({ type_line: 'Creature — Elf Druid' }))).toBe(false);
  });

  it('falls back to the first card face when top-level type_line is absent', () => {
    const dfc = card({
      type_line: undefined,
      card_faces: [{ type_line: 'Land' }, { type_line: 'Creature — Elemental' }],
    } as Partial<ScryfallCard>);
    expect(isLand(dfc)).toBe(true);
  });

  it('returns false when no type line is available anywhere', () => {
    expect(isLand(card({ type_line: undefined }))).toBe(false);
  });
});

describe('cardCmc', () => {
  it('returns the card cmc', () => {
    expect(cardCmc(card({ cmc: 5 }))).toBe(5);
  });

  it('defaults to 0 when cmc is missing', () => {
    expect(cardCmc(card({ cmc: undefined }))).toBe(0);
  });
});

describe('toSimCard', () => {
  it('reduces a card to the SimCard shape', () => {
    const sim = toSimCard(card({ cmc: 3, color_identity: ['G', 'W'] }));
    expect(sim).toEqual({ isLand: false, cmc: 3, role: null, colors: ['G', 'W'] });
  });

  it('marks lands and defaults missing color identity to empty', () => {
    const sim = toSimCard(
      card({ type_line: 'Basic Land — Mountain', cmc: 0, color_identity: undefined })
    );
    expect(sim.isLand).toBe(true);
    expect(sim.cmc).toBe(0);
    expect(sim.colors).toEqual([]);
  });

  it('leaves role null when tagger data is not loaded', () => {
    expect(toSimCard(card()).role).toBeNull();
  });
});
