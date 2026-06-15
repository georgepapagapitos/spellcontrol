/**
 * Distribution / invariant guard for the bracket estimator.
 *
 * The unit + reference suites pin specific decks. This suite asserts the
 * estimator's *output distribution* over a grid of realistic inputs, guarding the
 * two invariants the "select bracket 2 → builds a bracket 1" fix established:
 *
 *   1. Exhibition (1) is NEVER auto-assigned — Bracket 2 (Core) is the baseline.
 *      Per the official RC system, "the average current preconstructed deck is at
 *      a Core level"; Exhibition is a theme-build intent card power can't detect.
 *   2. A power-neutral deck (no game changers / fast mana / combos / stax) and the
 *      canonical "Core pool" shape both estimate to exactly Bracket 2.
 *
 * Asserting the distribution (not just a single verdict label) is deliberate:
 * a scoring heuristic can pass a handful of point fixtures while being wrong
 * across the space. See the project memory on auditing heuristics, not green tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectedCombo } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  hasTag: vi.fn(() => false),
  isMassLandDenial: vi.fn(() => false),
  isExtraTurn: vi.fn(() => false),
  getCardRole: vi.fn(() => null),
}));

import { estimateBracket } from './bracketEstimator';
import {
  hasTag,
  isMassLandDenial,
  isExtraTurn,
  getCardRole,
} from '@/deck-builder/services/tagger/client';

const mHasTag = vi.mocked(hasTag);
const mMLD = vi.mocked(isMassLandDenial);
const mET = vi.mocked(isExtraTurn);
const mRole = vi.mocked(getCardRole);

const FAST_MANA = [
  'Mana Crypt',
  'Mana Vault',
  'Grim Monolith',
  'Chrome Mox',
  'Mox Diamond',
  "Lion's Eye Diamond",
  'Lotus Petal',
  'Mox Opal',
];

/** Build a deck name list + game-changer set + tagger wiring for given signals. */
function deck(opts: { gc?: number; fastMana?: number; tutors?: number; extraTurns?: number }) {
  const names: string[] = [];
  const gcNames = new Set<string>();
  const tutors: string[] = [];
  const extraTurns: string[] = [];
  for (let i = 0; i < (opts.gc ?? 0); i++) {
    const n = `GC_${i}`;
    names.push(n);
    gcNames.add(n);
  }
  for (let i = 0; i < (opts.fastMana ?? 0); i++) names.push(FAST_MANA[i % FAST_MANA.length]);
  for (let i = 0; i < (opts.tutors ?? 0); i++) {
    const n = `TUT_${i}`;
    names.push(n);
    tutors.push(n);
  }
  for (let i = 0; i < (opts.extraTurns ?? 0); i++) {
    const n = `ET_${i}`;
    names.push(n);
    extraTurns.push(n);
  }
  while (names.length < 99) names.push(`Vanilla_${names.length}`);
  mHasTag.mockImplementation((n: string, tag: string) => tag === 'tutor' && tutors.includes(n));
  mRole.mockImplementation((n: string) => (tutors.includes(n) ? 'cardDraw' : null));
  mET.mockImplementation((n: string) => extraTurns.includes(n));
  mMLD.mockReturnValue(false);
  return { names, gcNames };
}

beforeEach(() => {
  mHasTag.mockReset().mockReturnValue(false);
  mMLD.mockReset().mockReturnValue(false);
  mET.mockReset().mockReturnValue(false);
  mRole.mockReset().mockReturnValue(null);
});

describe('estimateBracket — distribution invariants', () => {
  it('a power-neutral deck estimates to Core (2), never Exhibition (1)', () => {
    const { names, gcNames } = deck({});
    const r = estimateBracket(names, [], 3.2, undefined, { removal: 6, boardwipe: 2 }, gcNames);
    expect(r.bracket).toBe(2);
    expect(r.label).toBe('Core');
  });

  it('the canonical EDHREC "/core" pool shape (the user\'s bracket-2 request) → Core (2)', () => {
    // No game changers, no fast mana, no combos, moderate curve, real interaction.
    const { names, gcNames } = deck({});
    for (const cmc of [2.8, 3.0, 3.2, 3.5]) {
      const r = estimateBracket(names, [], cmc, undefined, { removal: 7, boardwipe: 1 }, gcNames);
      expect(r.bracket, `cmc ${cmc}`).toBe(2);
    }
  });

  it('NEVER auto-assigns Exhibition (1) anywhere across a realistic input grid', () => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    for (const gc of [0, 1, 2, 4])
      for (const fm of [0, 2, 5, 8])
        for (const tut of [0, 3])
          for (const et of [0, 3])
            for (const cmc of [1.8, 3.2, 3.8])
              for (const interaction of [0, 6, 14]) {
                const { names, gcNames } = deck({ gc, fastMana: fm, tutors: tut, extraTurns: et });
                const combos: DetectedCombo[] = [];
                const r = estimateBracket(
                  names,
                  combos,
                  cmc,
                  undefined,
                  { removal: interaction, boardwipe: 0 },
                  gcNames
                );
                counts[r.bracket]++;
                total++;
              }
    // The load-bearing invariant: bracket 1 is unreachable by estimation.
    expect(counts[1]).toBe(0);
    // Sanity: the grid actually exercises the upper brackets (not all collapsed to 2).
    expect(counts[2]).toBeGreaterThan(0);
    expect(counts[3] + counts[4] + counts[5]).toBeGreaterThan(0);
    expect(counts[1] + counts[2] + counts[3] + counts[4] + counts[5]).toBe(total);
  });

  it('preserves the game-changer floors (1–3 GC → ≥3, 4+ GC → ≥4)', () => {
    const oneGc = deck({ gc: 1 });
    expect(
      estimateBracket(oneGc.names, [], 3.2, undefined, undefined, oneGc.gcNames).bracket
    ).toBeGreaterThanOrEqual(3);
    const fourGc = deck({ gc: 4 });
    expect(
      estimateBracket(fourGc.names, [], 3.2, undefined, undefined, fourGc.gcNames).bracket
    ).toBeGreaterThanOrEqual(4);
  });

  it('any deck with a complete 2-card combo never estimates B1 or B2 (P0 regression)', () => {
    const twoCardCombo: DetectedCombo = {
      comboId: 'test-2card',
      cards: ['A', 'B'],
      results: ['Win'],
      isComplete: true,
      missingCards: [],
      deckCount: 1,
      bracket: null,
      bracketTag: null,
      cardCount: 2,
    };
    // Grid: vary gc/fastMana/cmc — the 2-card combo floor should always hold at ≥B3.
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const gc of [0, 1])
      for (const fm of [0, 3])
        for (const cmc of [2.5, 3.5]) {
          const { names, gcNames } = deck({ gc, fastMana: fm });
          const r = estimateBracket(names, [twoCardCombo], cmc, undefined, undefined, gcNames);
          counts[r.bracket]++;
        }
    // No deck with a 2-card combo should ever be B1 or B2.
    expect(counts[1]).toBe(0);
    expect(counts[2]).toBe(0);
  });
});
