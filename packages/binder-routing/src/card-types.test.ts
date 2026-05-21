import { describe, it, expect } from 'vitest';
import { getCardType, parseTypeLine, TYPE_ORDER } from './card-types.js';
import type { EnrichedCard } from './types.js';

function makeCard(typeLine?: string): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'abc-123',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil' as const,
    typeLine,
  };
}

describe('getCardType', () => {
  it('returns "other" for cards with no type line', () => {
    expect(getCardType(makeCard(undefined))).toBe('other');
    expect(getCardType(makeCard(''))).toBe('other');
  });

  it('identifies creatures', () => {
    expect(getCardType(makeCard('Creature — Human Warrior'))).toBe('creature');
    expect(getCardType(makeCard('Legendary Creature — Dragon'))).toBe('creature');
  });

  it('identifies planeswalkers', () => {
    expect(getCardType(makeCard('Legendary Planeswalker — Jace'))).toBe('planeswalker');
  });

  it('identifies instants', () => {
    expect(getCardType(makeCard('Instant'))).toBe('instant');
  });

  it('identifies sorceries', () => {
    expect(getCardType(makeCard('Sorcery'))).toBe('sorcery');
  });

  it('identifies enchantments', () => {
    expect(getCardType(makeCard('Enchantment — Aura'))).toBe('enchantment');
  });

  it('identifies artifacts', () => {
    expect(getCardType(makeCard('Artifact — Equipment'))).toBe('artifact');
    expect(getCardType(makeCard('Legendary Artifact'))).toBe('artifact');
  });

  it('identifies lands', () => {
    expect(getCardType(makeCard('Basic Land — Forest'))).toBe('land');
    expect(getCardType(makeCard('Land'))).toBe('land');
  });

  it('identifies battles', () => {
    expect(getCardType(makeCard('Battle — Siege'))).toBe('battle');
  });

  it('returns "other" for unknown types', () => {
    expect(getCardType(makeCard('Conspiracy'))).toBe('other');
    expect(getCardType(makeCard('Phenomenon'))).toBe('other');
  });

  it('prefers creature over artifact for artifact-creatures', () => {
    expect(getCardType(makeCard('Artifact Creature — Construct'))).toBe('creature');
  });

  it('prefers enchantment type before artifact in type order', () => {
    // Enchantment Artifact is unusual but should resolve to enchantment (comes first in TYPE_ORDER)
    expect(getCardType(makeCard('Enchantment Artifact'))).toBe('enchantment');
  });

  it('handles multi-face type lines (split / MDFC / reversible)', () => {
    expect(getCardType(makeCard('Land — Swamp Mountain // Land — Swamp Mountain'))).toBe('land');
    expect(getCardType(makeCard('Creature — Werewolf // Creature — Werewolf'))).toBe('creature');
    expect(getCardType(makeCard('Instant // Sorcery'))).toBe('instant');
  });
});

describe('TYPE_ORDER', () => {
  it('contains the expected card types', () => {
    expect(TYPE_ORDER).toContain('creature');
    expect(TYPE_ORDER).toContain('planeswalker');
    expect(TYPE_ORDER).toContain('instant');
    expect(TYPE_ORDER).toContain('sorcery');
    expect(TYPE_ORDER).toContain('enchantment');
    expect(TYPE_ORDER).toContain('artifact');
    expect(TYPE_ORDER).toContain('land');
    expect(TYPE_ORDER).toContain('other');
  });
});

describe('parseTypeLine', () => {
  it('returns empty buckets for missing/blank input', () => {
    expect(parseTypeLine(undefined)).toEqual({ supertypes: [], types: [], subtypes: [] });
    expect(parseTypeLine('')).toEqual({ supertypes: [], types: [], subtypes: [] });
    expect(parseTypeLine('   ')).toEqual({ supertypes: [], types: [], subtypes: [] });
  });

  it('parses a typical legendary creature', () => {
    expect(parseTypeLine('Legendary Creature — Human Wizard')).toEqual({
      supertypes: ['legendary'],
      types: ['creature'],
      subtypes: ['human', 'wizard'],
    });
  });

  it('parses a multi-type card (creature land)', () => {
    expect(parseTypeLine('Creature Land — Forest Beast')).toEqual({
      supertypes: [],
      types: ['creature', 'land'],
      subtypes: ['forest', 'beast'],
    });
  });

  it('parses cards with no subtypes', () => {
    expect(parseTypeLine('Sorcery')).toEqual({
      supertypes: [],
      types: ['sorcery'],
      subtypes: [],
    });
  });

  it('handles multiple supertypes', () => {
    expect(parseTypeLine('Basic Snow Land — Mountain')).toEqual({
      supertypes: ['basic', 'snow'],
      types: ['land'],
      subtypes: ['mountain'],
    });
  });

  it('uses the first face of a multi-face card', () => {
    expect(parseTypeLine('Land — Swamp // Creature — Zombie')).toEqual({
      supertypes: [],
      types: ['land'],
      subtypes: ['swamp'],
    });
  });

  it('drops unrecognized tokens from the left of the dash', () => {
    // Defensive: a hypothetical malformed line shouldn't crash and won't
    // pollute the buckets with garbage.
    expect(parseTypeLine('Foo Creature — Beast')).toEqual({
      supertypes: [],
      types: ['creature'],
      subtypes: ['beast'],
    });
  });
});
