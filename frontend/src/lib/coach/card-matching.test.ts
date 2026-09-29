import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  roleOf,
  sameRole,
  primaryTypeOf,
  sameType,
  colorsOverlap,
  withinColorIdentity,
} from './card-matching';

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

describe('roleOf', () => {
  it("uses the card's own deckRole when present", () => {
    expect(roleOf(card('A', { deckRole: 'ramp' }))).toBe('ramp');
  });

  it('falls back to the tagger (null for an unknown card offline)', () => {
    // No deckRole and a name the tagger can't classify → null.
    expect(roleOf(card('Zzz Unknown Card'))).toBeNull();
  });
});

describe('sameRole', () => {
  it('matches two cards sharing a non-null role', () => {
    expect(sameRole(card('A', { deckRole: 'ramp' }), card('B', { deckRole: 'ramp' }))).toBe(true);
  });

  it('rejects differing roles', () => {
    expect(sameRole(card('A', { deckRole: 'ramp' }), card('B', { deckRole: 'removal' }))).toBe(
      false
    );
  });

  it('rejects when either role is null (no false match on unclassified)', () => {
    expect(sameRole(card('A'), card('B'))).toBe(false);
    expect(sameRole(card('A', { deckRole: 'ramp' }), card('B'))).toBe(false);
  });
});

describe('primaryTypeOf', () => {
  it('strips Legendary and subtypes, returning the core type', () => {
    expect(primaryTypeOf(card('X', { type_line: 'Legendary Creature — God' }))).toBe('Creature');
    expect(primaryTypeOf(card('X', { type_line: 'Artifact Creature — Equipment' }))).toBe(
      'Creature'
    );
    expect(primaryTypeOf(card('X', { type_line: 'Instant' }))).toBe('Instant');
    expect(primaryTypeOf(card('X', { type_line: 'Enchantment — Aura' }))).toBe('Enchantment');
  });

  it('ignores Basic/Snow supertypes', () => {
    expect(primaryTypeOf(card('X', { type_line: 'Basic Snow Land — Mountain' }))).toBe('Land');
  });

  it('returns "" for an empty type line', () => {
    expect(primaryTypeOf(card('X', { type_line: '' }))).toBe('');
  });
});

describe('sameType', () => {
  it('matches cards resolving to the same primary type', () => {
    expect(
      sameType(
        card('A', { type_line: 'Legendary Creature — God' }),
        card('B', { type_line: 'Creature — Elf' })
      )
    ).toBe(true);
  });

  it('rejects differing types', () => {
    expect(
      sameType(card('A', { type_line: 'Creature' }), card('B', { type_line: 'Instant' }))
    ).toBe(false);
  });

  it('rejects when a type is empty (no false match on "")', () => {
    expect(sameType(card('A', { type_line: '' }), card('B', { type_line: '' }))).toBe(false);
  });
});

describe('colorsOverlap', () => {
  it('is true when the two cards share a color', () => {
    expect(
      colorsOverlap(card('A', { color_identity: ['W', 'U'] }), card('B', { color_identity: ['U'] }))
    ).toBe(true);
  });

  it('is false for disjoint identities', () => {
    expect(
      colorsOverlap(card('A', { color_identity: ['W'] }), card('B', { color_identity: ['B'] }))
    ).toBe(false);
  });

  it('is false when either card is colorless', () => {
    expect(
      colorsOverlap(card('A', { color_identity: [] }), card('B', { color_identity: ['G'] }))
    ).toBe(false);
  });
});

describe('withinColorIdentity', () => {
  it('accepts a subset of the allowed identity', () => {
    expect(withinColorIdentity(card('A', { color_identity: ['U'] }), ['W', 'U', 'B'])).toBe(true);
  });

  it('rejects a card with a color outside the identity', () => {
    expect(withinColorIdentity(card('A', { color_identity: ['R'] }), ['W', 'U'])).toBe(false);
  });

  it('treats colorless cards as always legal', () => {
    expect(withinColorIdentity(card('A', { color_identity: [] }), [])).toBe(true);
    expect(withinColorIdentity(card('A', { color_identity: [] }), ['G'])).toBe(true);
  });
});
