import { describe, expect, it, vi } from 'vitest';
import type { GapAnalysisCard } from '@/deck-builder/types';

// Tagger data isn't loaded in the test env, so the real role/subtype lookups
// would always return empty. Mock them with a small fixture taxonomy. Roles are
// listed per card so `cardMatchesRole` can match a non-primary role too.
vi.mock('@/deck-builder/services/tagger/client', () => {
  const roles: Record<string, string[]> = {
    'Mind Stone': ['ramp'],
    'Worn Powerstone': ['ramp'],
    'Llanowar Elves': ['ramp'],
    Cultivate: ['ramp'],
    'Off-Color Signet': ['ramp'],
    'Swords to Plowshares': ['removal'],
    'Wrath of God': ['boardwipe'],
    'Mystic Confluence': ['cardDraw', 'removal'], // multi-role; primary is cardDraw
  };
  const subtypes: Record<string, string | null> = {
    // wanted (missing) staples — only their subtype is consulted
    'Talisman of Dominance': 'mana-rock',
    'Dimir Signet': 'mana-rock',
    'Beast Within': 'spot-removal',
    // owned candidates
    'Mind Stone': 'mana-rock',
    'Worn Powerstone': 'mana-rock',
    'Llanowar Elves': 'mana-producer',
    Cultivate: 'ramp',
  };
  return {
    cardMatchesRole: (name: string, role: string) => (roles[name] ?? []).includes(role),
    getCardSubtype: (name: string) => subtypes[name] ?? null,
  };
});

import {
  findOwnedSubstitute,
  buildSubstitutionPlan,
  type SubstituteCandidate,
} from './substituteFinder';

// ── Fixtures ────────────────────────────────────────────────────────────

function owned(over: Partial<SubstituteCandidate> & { name: string }): SubstituteCandidate {
  return { colorIdentity: [], cmc: 2, ...over };
}

function missing(over: Partial<GapAnalysisCard> & { name: string }): GapAnalysisCard {
  return {
    price: null,
    inclusion: 50,
    synergy: 0,
    typeLine: 'Artifact',
    isOwned: false,
    ...over,
  };
}

const DIMIR = ['U', 'B'];

// ── findOwnedSubstitute ───────────────────────────────────────────────────

describe('findOwnedSubstitute', () => {
  it('returns the owned same-role card with a verdict reason', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', roleLabel: 'Ramp', cmc: 2 }),
      [owned({ name: 'Mind Stone', cmc: 2 })],
      new Set(),
      DIMIR
    );
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      wantedName: 'Talisman of Dominance',
      wantedRole: 'ramp',
      usedName: 'Mind Stone',
      usedSubtypeMatch: true,
    });
    expect(row!.reason).toBe('Mind Stone fills the 2-mana Ramp slot — owned, same mana rock.');
  });

  it('returns null when nothing owned fills the role (a genuine buy)', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
      [owned({ name: 'Swords to Plowshares' })], // removal only
      new Set(),
      DIMIR
    );
    expect(row).toBeNull();
  });

  it('prefers a same-subtype substitute over a closer-CMC one', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
      [
        owned({ name: 'Llanowar Elves', cmc: 2 }), // mana-producer, exact CMC, NO subtype match
        owned({ name: 'Worn Powerstone', cmc: 3 }), // mana-rock, worse CMC, subtype match
      ],
      new Set(),
      DIMIR
    );
    expect(row!.usedName).toBe('Worn Powerstone');
    expect(row!.usedSubtypeMatch).toBe(true);
  });

  it('excludes owned cards outside the deck color identity', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
      [owned({ name: 'Off-Color Signet', colorIdentity: ['R'] })],
      new Set(),
      DIMIR
    );
    expect(row).toBeNull();
  });

  it('excludes owned cards already in the deck', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
      [owned({ name: 'Mind Stone', cmc: 2 })],
      new Set(['Mind Stone']),
      DIMIR
    );
    expect(row).toBeNull();
  });

  it('matches a non-primary role of a multi-role card', () => {
    // Mystic Confluence's primary role is cardDraw, but it also matches removal.
    const row = findOwnedSubstitute(
      missing({ name: 'Beast Within', role: 'removal', roleLabel: 'Removal', cmc: 3 }),
      [owned({ name: 'Mystic Confluence', cmc: 5 })],
      new Set(),
      DIMIR
    );
    expect(row!.usedName).toBe('Mystic Confluence');
    expect(row!.usedSubtypeMatch).toBe(false);
    expect(row!.reason).toBe('Mystic Confluence fills the 3-mana Removal slot — owned, same role.');
  });

  it('returns null for a missing card with no functional role', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Some Vanilla Card' }), // no role
      [owned({ name: 'Mind Stone' })],
      new Set(),
      DIMIR
    );
    expect(row).toBeNull();
  });

  it('breaks ties on EDHREC inclusion when subtype and CMC are equal', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Dimir Signet', role: 'ramp', cmc: 2 }),
      [owned({ name: 'Mind Stone', cmc: 2 }), owned({ name: 'Worn Powerstone', cmc: 2 })],
      new Set(),
      DIMIR,
      {
        inclusionByName: new Map([
          ['Mind Stone', 30],
          ['Worn Powerstone', 70],
        ]),
      }
    );
    expect(row!.usedName).toBe('Worn Powerstone');
  });

  it('omits the mana prefix from the reason when the wanted CMC is unknown', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', roleLabel: 'Ramp' }), // no cmc
      [owned({ name: 'Mind Stone', cmc: 2 })],
      new Set(),
      DIMIR
    );
    expect(row!.reason).toBe('Mind Stone fills the Ramp slot — owned, same mana rock.');
  });
});

// ── buildSubstitutionPlan ──────────────────────────────────────────────────

describe('buildSubstitutionPlan', () => {
  it('assigns each owned card to at most one staple', () => {
    const plan = buildSubstitutionPlan(
      [
        missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
        missing({ name: 'Dimir Signet', role: 'ramp', cmc: 2 }),
      ],
      [owned({ name: 'Mind Stone', cmc: 2 }), owned({ name: 'Worn Powerstone', cmc: 2 })],
      new Set(),
      DIMIR
    );
    expect(plan.rows).toHaveLength(2);
    const used = plan.rows.map((r) => r.usedName).sort();
    expect(used).toEqual(['Mind Stone', 'Worn Powerstone']);
    expect(plan.unmatched).toEqual([]);
  });

  it('lists staples with no remaining substitute as unmatched', () => {
    const plan = buildSubstitutionPlan(
      [
        missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
        missing({ name: 'Dimir Signet', role: 'ramp', cmc: 2 }),
      ],
      [owned({ name: 'Mind Stone', cmc: 2 })], // only one owned ramp piece
      new Set(),
      DIMIR
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].usedName).toBe('Mind Stone');
    expect(plan.unmatched).toEqual(['Dimir Signet']);
  });
});
