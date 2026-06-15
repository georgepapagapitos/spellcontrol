import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectedCombo } from '@/deck-builder/types';

// Tagger reads a bundled JSON keyed by card name; mock so estimator behavior
// is exercised deterministically without touching the cached tag data.
vi.mock('@/deck-builder/services/tagger/client', () => ({
  hasTag: vi.fn(),
  isMassLandDenial: vi.fn(),
  isExtraTurn: vi.fn(),
  getCardRole: vi.fn(),
}));

import {
  hasTag,
  isMassLandDenial,
  isExtraTurn,
  getCardRole,
} from '@/deck-builder/services/tagger/client';
import { estimateBracket } from './bracketEstimator';

const mockHasTag = vi.mocked(hasTag);
const mockIsMLD = vi.mocked(isMassLandDenial);
const mockIsExtraTurn = vi.mocked(isExtraTurn);
const mockGetRole = vi.mocked(getCardRole);

beforeEach(() => {
  mockHasTag.mockReset().mockReturnValue(false);
  mockIsMLD.mockReset().mockReturnValue(false);
  mockIsExtraTurn.mockReset().mockReturnValue(false);
  mockGetRole.mockReset().mockReturnValue(null);
});

function combo(
  bracketNum: number | null = null,
  isComplete = true,
  cardCount = 2,
  bracketTag?: string
): DetectedCombo {
  return {
    comboId: `c-${bracketNum}`,
    cards: cardCount <= 2 ? ['A', 'B'] : ['A', 'B', 'C'],
    results: ['Win'],
    isComplete,
    missingCards: [],
    deckCount: 1,
    bracket: bracketNum,
    bracketTag: bracketTag ?? null,
    cardCount,
  };
}

describe('estimateBracket — output shape', () => {
  it('clamps to 1–5, includes label and breakdown', () => {
    const r = estimateBracket(
      ['Forest', 'Plains'],
      undefined,
      3.5,
      undefined,
      { removal: 0, boardwipe: 0 },
      new Set()
    );
    expect(r.bracket).toBeGreaterThanOrEqual(1);
    expect(r.bracket).toBeLessThanOrEqual(5);
    expect(r.label).toBeTypeOf('string');
    expect(r.breakdown.averageCmc).toBe(3.5);
    expect(r.softScore).toBeGreaterThanOrEqual(0);
    expect(r.softScore).toBeLessThanOrEqual(100);
  });

  it('returns Core (bracket 2) for an empty / vanilla deck — Exhibition is never auto-assigned', () => {
    const r = estimateBracket([], undefined, 4, undefined, undefined, new Set());
    expect(r.bracket).toBe(2);
    expect(r.label).toBe('Core');
    expect(r.hardFloors).toHaveLength(0);
  });
});

describe('estimateBracket — hard floors', () => {
  it('1–3 game changers → bracket 3 floor', () => {
    const r = estimateBracket(
      ['Cyclonic Rift', 'Forest'],
      undefined,
      4,
      undefined,
      undefined,
      new Set(['Cyclonic Rift'])
    );
    expect(r.bracket).toBeGreaterThanOrEqual(3);
    expect(r.hardFloors.some((f) => f.bracket === 3)).toBe(true);
    expect(r.breakdown.gameChangerCount).toBe(1);
  });

  it('4+ game changers → bracket 4 floor', () => {
    const gc = ['A', 'B', 'C', 'D'];
    const r = estimateBracket(gc, undefined, 4, undefined, undefined, new Set(gc));
    expect(r.bracket).toBeGreaterThanOrEqual(4);
    expect(r.hardFloors.some((f) => f.bracket === 4)).toBe(true);
    expect(r.breakdown.gameChangerCount).toBe(4);
  });

  it('mass land denial → bracket 4 floor', () => {
    mockIsMLD.mockImplementation((name: string) => name === 'Armageddon');
    const r = estimateBracket(
      ['Armageddon', 'Forest'],
      undefined,
      3,
      undefined,
      undefined,
      new Set()
    );
    expect(r.bracket).toBeGreaterThanOrEqual(4);
    expect(r.breakdown.massLandDenialCount).toBe(1);
  });

  // ── Root P0 bug regression ────────────────────────────────────────────────

  it('P0 REGRESSION: complete 2-card combo with null bracket → B3 floor (was B2)', () => {
    const r = estimateBracket(['Forest'], [combo(null)], 4, undefined, undefined, new Set());
    expect(r.bracket).toBeGreaterThanOrEqual(3);
    expect(r.breakdown.twoCardComboCount).toBe(1);
    expect(r.hardFloors.some((f) => f.bracket === 3)).toBe(true);
  });

  it('2-card combo with low acceleration → B3 floor', () => {
    const r = estimateBracket(['Forest'], [combo(3)], 4, undefined, undefined, new Set());
    expect(r.bracket).toBeGreaterThanOrEqual(3);
    expect(r.breakdown.twoCardComboCount).toBe(1);
  });

  it('2-card combo with accel score >= 4 (5 fast mana + 4 tutors) → B4 floor', () => {
    // accelerationScore: fastMana>=5 → +3, tutors>=4 → +1 = 4 (hits the B4 threshold).
    const fastManaCards = [
      'Mana Crypt',
      'Chrome Mox',
      'Mox Diamond',
      "Lion's Eye Diamond",
      'Grim Monolith',
    ];
    const tutorCards = ['Demonic Tutor', 'Vampiric Tutor', 'Imperial Seal', 'Mystical Tutor'];
    const tutorSet = new Set(tutorCards);
    mockHasTag.mockImplementation((n: string, tag: string) => tag === 'tutor' && tutorSet.has(n));
    mockGetRole.mockImplementation((n: string) => (tutorSet.has(n) ? 'cardDraw' : null));
    const r = estimateBracket(
      [...fastManaCards, ...tutorCards, 'Forest'],
      [combo(3)],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.fastManaCount).toBe(5);
    expect(r.breakdown.tutorCount).toBe(4);
    expect(r.bracket).toBeGreaterThanOrEqual(4);
    expect(r.breakdown.twoCardComboCount).toBe(1);
  });

  it('2-card combo with bracketTag R → B4 floor regardless of acceleration', () => {
    const r = estimateBracket(
      ['Forest'],
      [combo(4, true, 2, 'R')],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.bracket).toBeGreaterThanOrEqual(4);
  });

  it('2-card combo with bracketTag S → B4 floor regardless of acceleration', () => {
    const r = estimateBracket(
      ['Forest'],
      [combo(4, true, 2, 'S')],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.bracket).toBeGreaterThanOrEqual(4);
  });

  it('3+-card combo → no hard floor, only soft score', () => {
    const r = estimateBracket(['Forest'], [combo(4, true, 3)], 4, undefined, undefined, new Set());
    expect(r.breakdown.twoCardComboCount).toBe(0);
    expect(r.breakdown.multiCardComboCount).toBe(1);
    expect(r.hardFloors.filter((f) => f.reason.includes('combo'))).toHaveLength(0);
    expect(r.bracket).toBe(2);
  });

  it('incomplete combos still ignored', () => {
    const r = estimateBracket(
      ['Forest'],
      [combo(4, false), combo(null, false)],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.twoCardComboCount).toBe(0);
    expect(r.bracket).toBe(2);
  });

  it('2+ slow two-card combos with low acceleration → B3 floor (no R2 escalation)', () => {
    const r = estimateBracket(
      ['Forest'],
      [combo(3), combo(null)],
      4,
      undefined,
      undefined,
      new Set()
    );
    // R2 override: multiple slow 2-card combos without acceleration/R/S tag stay at B3.
    expect(r.bracket).toBe(3);
    expect(r.breakdown.twoCardComboCount).toBe(2);
    expect(r.hardFloors.some((f) => f.bracket === 3)).toBe(true);
    expect(r.hardFloors.some((f) => f.bracket === 4)).toBe(false);
  });

  it('1–2 extra turn spells do not trigger a bracket floor (RC: chaining is the issue)', () => {
    mockIsExtraTurn.mockImplementation(
      (name: string) => name === 'Time Warp' || name === 'Temporal Mastery'
    );
    const r = estimateBracket(
      ['Time Warp', 'Temporal Mastery', 'Forest'],
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.extraTurnCount).toBe(2);
    expect(r.hardFloors.find((f) => f.reason.includes('extra turn'))).toBeUndefined();
    // No hard floor → Core (2) baseline (not Exhibition).
    expect(r.bracket).toBe(2);
  });

  it('3+ extra turn spells trigger the bracket-4 floor (chain-likely, RC: B4 behavior)', () => {
    const names = ['Time Warp', 'Temporal Mastery', 'Walk the Aeons'];
    mockIsExtraTurn.mockImplementation((name: string) => names.includes(name));
    const r = estimateBracket([...names, 'Forest'], undefined, 4, undefined, undefined, new Set());
    expect(r.breakdown.extraTurnCount).toBe(3);
    expect(r.bracket).toBeGreaterThanOrEqual(4);
    expect(r.hardFloors.some((f) => f.bracket === 4 && f.reason.includes('extra turn'))).toBe(true);
  });

  it('stacks multiple floors and uses the highest', () => {
    mockIsExtraTurn.mockImplementation((n: string) => n === 'Time Warp');
    mockIsMLD.mockImplementation((n: string) => n === 'Armageddon');
    const r = estimateBracket(
      ['Time Warp', 'Armageddon', 'Forest'],
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    // MLD (4) wins
    expect(r.bracket).toBeGreaterThanOrEqual(4);
  });

  it('0–2 stax pieces do not trigger a bracket floor (toolbox use)', () => {
    const r = estimateBracket(
      ['Cursed Totem', 'Null Rod', 'Forest'],
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.staxPieceCount).toBe(2);
    expect(r.hardFloors.find((f) => f.reason.includes('stax'))).toBeUndefined();
    // No hard floor → Core (2) baseline.
    expect(r.bracket).toBe(2);
  });

  it('3–4 stax pieces trigger the bracket-3 floor (deliberate plan)', () => {
    const r = estimateBracket(
      ['Cursed Totem', 'Null Rod', 'Stony Silence', 'Forest'],
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.staxPieceCount).toBe(3);
    expect(r.bracket).toBeGreaterThanOrEqual(3);
    expect(r.hardFloors.some((f) => f.bracket === 3 && f.reason.includes('stax'))).toBe(true);
  });

  it('5+ stax pieces trigger the bracket-4 floor (stax-focused strategy)', () => {
    const r = estimateBracket(
      [
        'Winter Orb',
        'Static Orb',
        'Smokestack',
        'Sphere of Resistance',
        'Thorn of Amethyst',
        'Forest',
      ],
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.staxPieceCount).toBe(5);
    expect(r.bracket).toBeGreaterThanOrEqual(4);
    expect(r.hardFloors.some((f) => f.bracket === 4 && f.reason.includes('stax'))).toBe(true);
  });
});

describe('estimateBracket — soft score', () => {
  it('fast mana density contributes (capped at 40 points)', () => {
    // 5 fast mana cards × 8 = 40 (the cap). Sol Ring is intentionally excluded
    // from the FAST_MANA set (RC: allowed in brackets 1–2 as a precon staple).
    const names = ['Mana Crypt', 'Mana Vault', 'Mox Diamond', 'Chrome Mox', 'Lotus Petal'];
    const r = estimateBracket(names, undefined, 4, undefined, undefined, new Set());
    expect(r.breakdown.fastManaCount).toBe(5);
    expect(r.softScore).toBeGreaterThanOrEqual(40);
  });

  it('Sol Ring does not contribute to fast-mana density (precon staple)', () => {
    const r = estimateBracket(['Sol Ring'], undefined, 4, undefined, undefined, new Set());
    expect(r.breakdown.fastManaCount).toBe(0);
    expect(r.breakdown.fastManaNames).not.toContain('Sol Ring');
  });

  it('tutor count only counts cards whose primary role is cardDraw', () => {
    mockHasTag.mockImplementation((_: string, tag: string) => tag === 'tutor');
    mockGetRole.mockImplementation((name: string) =>
      name === 'Demonic Tutor' ? 'cardDraw' : 'ramp'
    );
    const r = estimateBracket(
      ['Demonic Tutor', 'Cultivate'],
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.tutorCount).toBe(1);
    expect(r.breakdown.tutorNames).toEqual(['Demonic Tutor']);
  });

  it('low average CMC contributes to soft score', () => {
    const highCmc = estimateBracket(['Forest'], undefined, 5, undefined, undefined, new Set());
    const lowCmc = estimateBracket(['Forest'], undefined, 1.5, undefined, undefined, new Set());
    expect(lowCmc.softScore).toBeGreaterThan(highCmc.softScore);
  });

  it('interaction percentage contributes per ScrollVault thresholds (10–22% non-land)', () => {
    // Use a Commander-sized deck so the non-land denominator is realistic.
    const deck = Array.from({ length: 99 }, (_, i) => `C${i}`);
    const low = estimateBracket(
      deck,
      undefined,
      4,
      undefined,
      { removal: 4, boardwipe: 2 }, // 6 / 62 = 9.7% — below 10% floor, no bonus
      new Set()
    );
    const mid = estimateBracket(
      deck,
      undefined,
      4,
      undefined,
      { removal: 8, boardwipe: 2 }, // 10 / 62 = 16.1% — between floor and cap
      new Set()
    );
    const high = estimateBracket(
      deck,
      undefined,
      4,
      undefined,
      { removal: 12, boardwipe: 3 }, // 15 / 62 = 24.2% — over the 22% cap
      new Set()
    );
    expect(low.softScore).toBe(0);
    expect(mid.softScore).toBeGreaterThan(low.softScore);
    expect(high.softScore).toBeGreaterThan(mid.softScore);
    expect(low.breakdown.interactionCount).toBe(6);
    expect(high.breakdown.interactionCount).toBe(15);
  });
});

describe('estimateBracket — soft score promotion', () => {
  it('promotes floor < 4 by +1 when softScore ≥ 66', () => {
    // High fast-mana + low CMC + high interaction → very high soft score
    const r = estimateBracket(
      ['Sol Ring', 'Mana Crypt', 'Mana Vault', 'Mox Diamond', 'Chrome Mox', 'Lotus Petal'],
      undefined,
      1.5,
      undefined,
      { removal: 12, boardwipe: 5 },
      new Set()
    );
    expect(r.softScore).toBeGreaterThanOrEqual(66);
    // No hard floor (no game changers, no MLD, no combos, no extra turns) → Core (2)
    // baseline, promoted +1 to Upgraded (3) by the high soft score. A turbo low-curve
    // fast-mana shell genuinely plays above Core.
    expect(r.bracket).toBe(3);
  });

  it('promotes floor ≥ 4 to bracket 5 when softScore ≥ 80', () => {
    mockIsMLD.mockImplementation((n: string) => n === 'Armageddon');
    mockHasTag.mockImplementation((_: string, tag: string) => tag === 'tutor');
    mockGetRole.mockReturnValue('cardDraw');
    const r = estimateBracket(
      [
        'Armageddon',
        'Sol Ring',
        'Mana Crypt',
        'Mana Vault',
        'Mox Diamond',
        'Chrome Mox',
        'Lotus Petal',
        'Demonic Tutor',
        'Vampiric Tutor',
        'Imperial Seal',
        'Grim Tutor',
        'Diabolic Intent',
      ],
      undefined,
      1.5,
      undefined,
      { removal: 12, boardwipe: 5 },
      new Set()
    );
    expect(r.softScore).toBeGreaterThanOrEqual(80);
    expect(r.bracket).toBe(5);
  });

  it('caps soft-score promotion at bracket 4 when floor < 4', () => {
    // Floor 3 from a single game changer + high soft score → 4, not 5
    const r = estimateBracket(
      ['Cyclonic Rift', 'Sol Ring', 'Mana Crypt', 'Mana Vault', 'Mox Diamond', 'Chrome Mox'],
      undefined,
      1.5,
      undefined,
      { removal: 12, boardwipe: 5 },
      new Set(['Cyclonic Rift'])
    );
    expect(r.bracket).toBe(4);
  });

  it('does not promote when softScore is below 66', () => {
    const r = estimateBracket(
      ['Sol Ring', 'Mana Crypt'], // only 16 soft points
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.softScore).toBeLessThan(66);
    // Below the promotion threshold → stays at the Core (2) baseline.
    expect(r.bracket).toBe(2);
  });
});
