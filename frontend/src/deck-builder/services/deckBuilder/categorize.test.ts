import { describe, it, expect } from 'vitest';
import { matchesExpectedType, categorizeCards, computeRoleBoosts } from './categorize';
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

  it('penalizes roles at/over target only when strictRoles is on', () => {
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
    expect(lenient.has('X')).toBe(false); // no boost, no penalty
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
