import { describe, it, expect } from 'vitest';
import { getCardType, TYPE_ORDER } from './card-types';
import type { EnrichedCard } from '../types';

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
