import { describe, it, expect } from 'vitest';
import {
  matchesExpectedType,
  categorizeCards,
  routeCardByType,
  computeRoleBoosts,
  roleCapTolerance,
} from './categorize';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

function sc(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

function emptyCategories(): Record<DeckCategory, ScryfallCard[]> {
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

describe('matchesExpectedType', () => {
  it('matches simple types by substring', () => {
    expect(matchesExpectedType('Legendary Creature — Elf', 'creature')).toBe(true);
    expect(matchesExpectedType('Instant', 'instant')).toBe(true);
    expect(matchesExpectedType('Sorcery', 'sorcery')).toBe(true);
    expect(matchesExpectedType('Land', 'land')).toBe(true);
  });

  it('excludes artifact/enchantment creatures and lands from those buckets', () => {
    expect(matchesExpectedType('Artifact', 'artifact')).toBe(true);
    expect(matchesExpectedType('Artifact Creature — Golem', 'artifact')).toBe(false);
    expect(matchesExpectedType('Artifact Land', 'artifact')).toBe(false);
    expect(matchesExpectedType('Enchantment Creature — God', 'enchantment')).toBe(false);
  });

  it('returns false for unknown expected types', () => {
    expect(matchesExpectedType('Creature', 'tribal')).toBe(false);
  });
});

describe('categorizeCards', () => {
  it('falls back to the given category when no tagger role is available', () => {
    // Tagger data is not loaded in this test → getCardRole returns null
    const categories = emptyCategories();
    categorizeCards([sc({ name: 'A' }), sc({ name: 'B' })], categories, 'synergy');
    expect(categories.synergy.map((c) => c.name)).toEqual(['A', 'B']);
    expect(categories.creatures).toHaveLength(0);
  });

  it('routes a land to lands regardless of fallback (would otherwise land in synergy)', () => {
    // Eldrazi Temple-style bug: a land with no tagger role (or a high synergy
    // score) must still count toward the manabase, not the synergy bucket.
    const categories = emptyCategories();
    categorizeCards([sc({ name: 'Eldrazi Temple', type_line: 'Land' })], categories, 'synergy');
    expect(categories.lands.map((c) => c.name)).toEqual(['Eldrazi Temple']);
    expect(categories.synergy).toHaveLength(0);
  });
});

describe('routeCardByType', () => {
  it('routes lands to lands ahead of role/synergy fallback', () => {
    const categories = emptyCategories();
    routeCardByType(sc({ name: 'Eldrazi Temple', type_line: 'Land' }), categories);
    expect(categories.lands.map((c) => c.name)).toEqual(['Eldrazi Temple']);
    expect(categories.synergy).toHaveLength(0);
  });

  it('routes creatures to creatures and falls back non-creature spells to synergy', () => {
    const categories = emptyCategories();
    routeCardByType(sc({ name: 'Bear', type_line: 'Creature — Bear' }), categories);
    routeCardByType(sc({ name: 'Opt', type_line: 'Instant' }), categories);
    expect(categories.creatures.map((c) => c.name)).toEqual(['Bear']);
    expect(categories.synergy.map((c) => c.name)).toEqual(['Opt']);
  });
});

describe('computeRoleBoosts', () => {
  const targets: Record<RoleKey, number> = { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 };

  it('boosts cards whose role is under target', () => {
    const roleMap = new Map<string, RoleKey>([['Cultivate', 'ramp']]);
    const boosts = computeRoleBoosts(roleMap, targets, {
      ramp: 0,
      removal: 0,
      boardwipe: 0,
      cardDraw: 0,
    });
    expect(boosts.get('Cultivate')).toBeGreaterThan(0);
  });

  it('gives low-CMC ramp a larger early-acceleration multiplier', () => {
    const roleMap = new Map<string, RoleKey>([
      ['SolRing', 'ramp'],
      ['Gilded', 'ramp'],
    ]);
    const counts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    const cmc = new Map<string, number>([
      ['SolRing', 1],
      ['Gilded', 5],
    ]);
    const boosts = computeRoleBoosts(roleMap, targets, counts, undefined, cmc);
    expect(boosts.get('SolRing')!).toBeGreaterThan(boosts.get('Gilded')!);
  });

  it('does not penalize a role right at target in non-strict mode (within tolerance)', () => {
    const roleMap = new Map<string, RoleKey>([['X', 'ramp']]);
    const atTarget = { ramp: 10, removal: 0, boardwipe: 0, cardDraw: 0 };
    const lenient = computeRoleBoosts(
      roleMap,
      targets,
      atTarget,
      undefined,
      undefined,
      undefined,
      undefined,
      false
    );
    expect(lenient.has('X')).toBe(false); // within tolerance — no boost, no penalty
  });

  it('softly penalizes a role well over target even in non-strict (default) mode', () => {
    const roleMap = new Map<string, RoleKey>([['X', 'ramp']]);
    // ramp target is 10; tolerance = max(2, round(10*0.2)) = 2, so current must be >= 12 to penalize
    const wellOver = { ramp: 15, removal: 0, boardwipe: 0, cardDraw: 0 };
    const lenient = computeRoleBoosts(
      roleMap,
      targets,
      wellOver,
      undefined,
      undefined,
      undefined,
      undefined,
      false
    );
    expect(lenient.get('X')!).toBeLessThan(0);
  });

  it('penalizes roles at/over target more strongly when strictRoles is on', () => {
    const roleMap = new Map<string, RoleKey>([['X', 'ramp']]);
    const atTarget = { ramp: 10, removal: 0, boardwipe: 0, cardDraw: 0 };
    const strict = computeRoleBoosts(
      roleMap,
      targets,
      atTarget,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    expect(strict.get('X')!).toBeLessThan(0);
  });

  it('strongly penalizes a role with a zero target under strictRoles', () => {
    const roleMap = new Map<string, RoleKey>([['Y', 'boardwipe']]);
    const zeroBoardwipe: Record<RoleKey, number> = {
      ramp: 10,
      removal: 8,
      boardwipe: 0,
      cardDraw: 10,
    };
    const boosts = computeRoleBoosts(
      roleMap,
      zeroBoardwipe,
      { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    expect(boosts.get('Y')).toBe(-100);
  });
});

// roleCapTolerance is the generic pick-time band (max 2, else 20% of target),
// role-agnostic. E113's tighter board-wipe cap is NOT here — it lives in
// phaseRoleSurplusRebalance's post-fill BOARDWIPE_SURPLUS_TOLERANCE (trim to
// exactly target), so pick time stays generous and the quality-aware rebalance
// does the wipe trim. See phaseRoleSurplusRebalance.test.ts.
describe('roleCapTolerance', () => {
  it('floors at 2 cards for small targets', () => {
    expect(roleCapTolerance(1)).toBe(2);
    expect(roleCapTolerance(5)).toBe(2);
  });

  it('scales to 20% of target once that exceeds 2', () => {
    expect(roleCapTolerance(10)).toBe(2);
    expect(roleCapTolerance(15)).toBe(3);
    expect(roleCapTolerance(20)).toBe(4);
  });
});
