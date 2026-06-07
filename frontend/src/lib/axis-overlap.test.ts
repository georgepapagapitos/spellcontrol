import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { axisKeys, axisJaccard, sharedAxisNames, axisLabel } from './axis-overlap';

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

describe('axisKeys', () => {
  it('captures producer and payoff sides from oracle text', () => {
    const keys = axisKeys(
      card('Tokens', { oracle_text: 'Create a 1/1 white Soldier creature token.' })
    );
    expect(keys.has('tokens:producer')).toBe(true);
  });

  it('is empty for a vanilla card', () => {
    expect(axisKeys(card('Bear')).size).toBe(0);
  });
});

describe('axisJaccard', () => {
  it('is 1 for identical non-empty sets', () => {
    expect(axisJaccard(new Set(['tokens:producer']), new Set(['tokens:producer']))).toBe(1);
  });

  it('is 0 when either set is empty', () => {
    expect(axisJaccard(new Set(), new Set(['tokens:producer']))).toBe(0);
    expect(axisJaccard(new Set(['tokens:producer']), new Set())).toBe(0);
  });

  it('is the intersection over union for partial overlap', () => {
    const a = new Set(['tokens:producer', 'sacrifice:payoff']);
    const b = new Set(['tokens:producer', 'graveyard:producer']);
    expect(axisJaccard(a, b)).toBeCloseTo(1 / 3); // 1 shared of 3 distinct
  });
});

describe('sharedAxisNames', () => {
  it('returns bare, deduped axis names for shared keys', () => {
    const a = new Set(['tokens:producer', 'tokens:payoff', 'mill:producer']);
    const b = new Set(['tokens:producer', 'tokens:payoff']);
    expect(sharedAxisNames(a, b).sort()).toEqual(['tokens']);
  });

  it('is empty with no shared keys', () => {
    expect(sharedAxisNames(new Set(['tokens:producer']), new Set(['mill:payoff']))).toEqual([]);
  });
});

describe('axisLabel', () => {
  it('shortens a descriptive registry label to its head', () => {
    expect(axisLabel('tokens')).toBe('Tokens');
  });

  it('falls back to the key for an unknown axis', () => {
    expect(axisLabel('nonsense')).toBe('nonsense');
  });
});
