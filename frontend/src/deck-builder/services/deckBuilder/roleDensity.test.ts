import { describe, expect, it, vi } from 'vitest';

// Tagger data isn't loaded in the test env, so the real lookup returns []. Mock
// it with a small fixture taxonomy; several cards list multiple roles so the
// overlap counting is exercised.
vi.mock('@/deck-builder/services/tagger/client', () => {
  const roles: Record<string, string[]> = {
    'Mind Stone': ['ramp', 'cardDraw'], // mana rock that also cantrips
    'Llanowar Elves': ['ramp'],
    'Mystic Confluence': ['cardDraw', 'removal'],
    'Wrath of God': ['boardwipe', 'removal'],
    'Swords to Plowshares': ['removal'],
    'Vanilla Bear': [], // no role hits
  };
  return {
    getAllCardRoles: (name: string) => roles[name] ?? [],
  };
});

import { computeRoleDensity } from './roleDensity';

describe('computeRoleDensity', () => {
  it('counts a card toward every role it fills (overlapping totals)', () => {
    const density = computeRoleDensity([
      { name: 'Mind Stone' }, // ramp + cardDraw
      { name: 'Mystic Confluence' }, // cardDraw + removal
      { name: 'Wrath of God' }, // boardwipe + removal
      { name: 'Swords to Plowshares' }, // removal
    ]);
    expect(density).toEqual({ ramp: 1, removal: 3, boardwipe: 1, cardDraw: 2 });
  });

  it('skips lands even if the tagger would tag them', () => {
    const density = computeRoleDensity([
      { name: 'Mind Stone', type_line: 'Artifact' },
      { name: 'Llanowar Elves', type_line: 'Land' }, // skipped despite ramp tag
    ]);
    expect(density).toEqual({ ramp: 1, removal: 0, boardwipe: 0, cardDraw: 1 });
  });

  it('skips lands whose type line only exists on the first face', () => {
    const density = computeRoleDensity([
      {
        name: 'Llanowar Elves',
        card_faces: [{ type_line: 'Land — Forest' }, { type_line: 'Land — Forest' }],
      },
    ]);
    expect(density).toEqual({ ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 });
  });

  it('ignores cards with no role hits and returns all-zero for an empty deck', () => {
    expect(computeRoleDensity([{ name: 'Vanilla Bear' }])).toEqual({
      ramp: 0,
      removal: 0,
      boardwipe: 0,
      cardDraw: 0,
    });
    expect(computeRoleDensity([])).toEqual({
      ramp: 0,
      removal: 0,
      boardwipe: 0,
      cardDraw: 0,
    });
  });
});
