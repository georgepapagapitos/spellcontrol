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

  it('2-card combo with bracketTag S and low acceleration → B3 only (no auto-escalation)', () => {
    // 'S' (Spicy) is the casual↔competitive bridge and covers slow, fragile combos;
    // it no longer auto-escalates to B4. Without R-tag or high acceleration the
    // combo floors at B3 (E48 calibration — fixed over-rating casual S-tag decks).
    const r = estimateBracket(
      ['Forest'],
      [combo(4, true, 2, 'S')],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.bracket).toBe(3);
    expect(r.hardFloors.some((f) => f.bracket === 4)).toBe(false);
  });

  it('a single 3+-card combo stays below the E97 floor gate — no escalation', () => {
    // MULTI_CARD_COMBO_WEIGHT (0.5) means one multi-card combo contributes 0.5
    // toward effectiveComboCount, below the >=1 gate — an isolated 3+-card
    // value line shouldn't blow a casual deck into a higher bracket.
    const r = estimateBracket(['Forest'], [combo(4, true, 3)], 4, undefined, undefined, new Set());
    expect(r.breakdown.twoCardComboCount).toBe(0);
    expect(r.breakdown.multiCardComboCount).toBe(1);
    expect(r.hardFloors.filter((f) => f.reason.includes('combo'))).toHaveLength(0);
    expect(r.bracket).toBe(2);
  });

  // ── E97: multi-card completed combos now count toward the floor (discounted) ──

  it('E97: 2 complete multi-card combos alone clear the floor gate (2 multi-card ≈ 1 two-card)', () => {
    const r = estimateBracket(
      ['Forest'],
      [combo(null, true, 3), combo(null, true, 3)],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.twoCardComboCount).toBe(0);
    expect(r.breakdown.multiCardComboCount).toBe(2);
    expect(r.bracket).toBe(3);
    expect(r.hardFloors.some((f) => f.bracket === 3 && f.reason.includes('multi-card'))).toBe(true);
  });

  it('E97: 3 complete multi-card combos escalate to a B3 floor', () => {
    const r = estimateBracket(
      ['Forest'],
      [combo(null, true, 3), combo(null, true, 3), combo(null, true, 3)],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.multiCardComboCount).toBe(3);
    expect(r.bracket).toBe(3);
    expect(r.hardFloors.some((f) => f.bracket === 3 && f.reason.includes('multi-card'))).toBe(true);
  });

  it('E97: many complete multi-card combos alone escalate to B4 by redundancy', () => {
    // 8 * 0.5 = 4.0, clearing COMBO_REDUNDANCY_THRESHOLD on its own.
    const combos = Array.from({ length: 8 }, () => combo(null, true, 3));
    const r = estimateBracket(['Forest'], combos, 4, undefined, undefined, new Set());
    expect(r.breakdown.multiCardComboCount).toBe(8);
    expect(r.bracket).toBe(4);
    const comboFloor = r.hardFloors.find((f) => f.reason.includes('multi-card'));
    expect(comboFloor?.bracket).toBe(4);
    expect(comboFloor?.reason).toContain('redundant');
  });

  it('E97: two-card combos + multi-card combos combine to cross the redundancy threshold', () => {
    // Mirrors the flagship panel case (E97 board item): a deck with a couple
    // two-card combos AND several complete multi-card variants of a shared
    // "hub" engine (e.g. Magistrate's Scepter + Contagion Engine + <any of
    // several proliferate pieces>) — individually below B4, combined effective
    // count (2 + 6*0.5 = 5) clears it.
    const twoCard = [combo(null), combo(null)];
    const multiCard = Array.from({ length: 6 }, () => combo(null, true, 3));
    const r = estimateBracket(
      ['Forest'],
      [...twoCard, ...multiCard],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.twoCardComboCount).toBe(2);
    expect(r.breakdown.multiCardComboCount).toBe(6);
    expect(r.bracket).toBe(4);
  });

  it('E97: pure two-card combo behavior is byte-unchanged (multiCardComboCount = 0)', () => {
    const r = estimateBracket(
      ['Forest'],
      [combo(null), combo(null)],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.multiCardComboCount).toBe(0);
    expect(r.bracket).toBe(3);
    const floor = r.hardFloors.find((f) => f.reason.includes('combo'));
    expect(floor?.reason).toBe('2 two-card combos');
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

  it('4+ two-card combos escalate to B4 by redundancy alone (no fast mana, no tutors, no tags)', () => {
    // Combo density is its own consistency engine: many interchangeable combos
    // assemble reliably even with zero fast mana / tutors and untagged combos
    // (the offline / pre-ingest case where bracketTag is null). The classic deck
    // is Elfball — mana dorks ARE the combo. This is tag-independent so a stale
    // combo dataset can't silently under-rate a combo deck.
    const r = estimateBracket(
      ['Forest'],
      [combo(null), combo(null), combo(null), combo(null)],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.twoCardComboCount).toBe(4);
    expect(r.bracket).toBe(4);
    const comboFloor = r.hardFloors.find((f) => f.reason.includes('combo'));
    expect(comboFloor?.bracket).toBe(4);
    expect(comboFloor?.reason).toContain('redundant');
  });

  it('3 two-card combos stay at B3 — below the redundancy threshold', () => {
    const r = estimateBracket(
      ['Forest'],
      [combo(null), combo(null), combo(null)],
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.twoCardComboCount).toBe(3);
    expect(r.bracket).toBe(3);
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

  it('3+ extra turn spells trigger a bracket-3 floor (sub-theme, not chaining)', () => {
    // A flat count of 3 one-shot extra-turn spells is a deliberate sub-theme (B3),
    // not provable infinite chaining (B4) — true infinite-turn engines are caught
    // by the two-card combo path. E48: softened 4→3 with no corpus regression.
    const names = ['Time Warp', 'Temporal Mastery', 'Walk the Aeons'];
    mockIsExtraTurn.mockImplementation((name: string) => names.includes(name));
    const r = estimateBracket([...names, 'Forest'], undefined, 4, undefined, undefined, new Set());
    expect(r.breakdown.extraTurnCount).toBe(3);
    expect(r.bracket).toBe(3);
    expect(r.hardFloors.some((f) => f.bracket === 3 && f.reason.includes('extra turn'))).toBe(true);
    expect(r.hardFloors.some((f) => f.bracket === 4 && f.reason.includes('extra turn'))).toBe(
      false
    );
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

  it('known mass-land-denial false positives do not floor B4 (tagger noise guard)', () => {
    // The upstream otag mislabels Gideon, Champion of Justice (a one-sided wipe) as
    // mass land denial; since MLD → B4 is the harshest floor, that turned a B2 precon
    // into B4 (E48). The denylist neutralizes the known false positives.
    mockIsMLD.mockImplementation((n: string) => n === 'Gideon, Champion of Justice');
    const r = estimateBracket(
      ['Gideon, Champion of Justice', 'Forest'],
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.massLandDenialCount).toBe(0);
    expect(r.hardFloors.some((f) => f.reason.includes('Mass land denial'))).toBe(false);
    expect(r.bracket).toBe(2);
  });

  it('Liliana, Dreadhorde General does not floor B4 (upstream otag mistag, not land denial)', () => {
    // Her -9 forces "sac all but one permanent of each type" — a whole-board wipe
    // that only incidentally touches lands, not dedicated land destruction. The
    // upstream mass-land-denial otag swept her in anyway (Meren eval).
    mockIsMLD.mockImplementation((n: string) => n === 'Liliana, Dreadhorde General');
    const r = estimateBracket(
      ['Liliana, Dreadhorde General', 'Forest'],
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.massLandDenialCount).toBe(0);
    expect(r.bracket).toBe(2);
  });

  it('Liliana of the Veil does not floor B4 (same non-land-specific sacrifice overreach)', () => {
    // -6 lets the *target player* choose which pile (of their own permanents) to
    // sacrifice — not a dedicated land-denial effect either.
    mockIsMLD.mockImplementation((n: string) => n === 'Liliana of the Veil');
    const r = estimateBracket(
      ['Liliana of the Veil', 'Forest'],
      undefined,
      4,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.massLandDenialCount).toBe(0);
    expect(r.bracket).toBe(2);
  });

  it('counterspells count toward interaction density even when not tagged removal', () => {
    // getCardRole never emits a counterspell role, so pure counterspells were
    // invisible to the interaction soft signal (audit P2 #6). They now contribute.
    mockHasTag.mockImplementation((_n: string, tag: string) => tag === 'counterspell');
    mockGetRole.mockReturnValue(null); // pure counters: no removal/boardwipe role
    const counters = Array.from({ length: 12 }, (_, i) => `Counter ${i}`);
    const r = estimateBracket(counters, undefined, 3, undefined, {}, new Set());
    expect(r.breakdown.interactionCount).toBe(12);
  });

  // ── P1/P2 targeted regression tests ──────────────────────────────────────

  // b1: Tagger load race — when tagger data isn't loaded yet, all tag-based
  // lookups (isMassLandDenial, isExtraTurn, hasTag) return false. The estimator
  // must NOT erroneously set a hard floor based on those signals; that would
  // over-rate and cache a wrong answer. By contrast, once the tagger resolves
  // the correct signals fire. The fix (audit P1 #4) is in analyzeCommanderDeck
  // which awaits loadTaggerData() before calling estimateBracket. Here we assert
  // the estimator's own signal-counting logic: with tagger returning all-false
  // (simulating not-ready), MLD and extra-turn counts stay at 0.
  it('b1: MLD and extra-turn counts are 0 when tagger not loaded (all-false mocks)', () => {
    // Mocks default to false (see beforeEach) — exactly what hasTaggerData()=false produces.
    // A deck containing Armageddon + Time Warp should produce no MLD/extra-turn signals
    // when the tagger hasn't loaded; only after loadTaggerData resolves do they fire.
    const r = estimateBracket(
      ['Armageddon', 'Time Warp', 'Temporal Mastery', 'Walk the Aeons', 'Forest'],
      undefined,
      3.5,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.massLandDenialCount).toBe(0);
    expect(r.breakdown.extraTurnCount).toBe(0);
    // With no floors from either signal, deck stays at Core (2) baseline.
    expect(r.bracket).toBe(2);
    expect(
      r.hardFloors.filter((f) => f.reason.includes('land') || f.reason.includes('extra'))
    ).toHaveLength(0);
  });

  it('b1: MLD fires correctly once tagger is ready (mocks return true)', () => {
    // Contrast: when tagger IS ready (isMassLandDenial returns true), the B4 floor fires.
    mockIsMLD.mockImplementation((name: string) => name === 'Armageddon');
    const r = estimateBracket(
      ['Armageddon', 'Forest'],
      undefined,
      3.5,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.massLandDenialCount).toBe(1);
    expect(
      r.hardFloors.some((f) => f.bracket === 4 && f.reason.toLowerCase().includes('land'))
    ).toBe(true);
    expect(r.bracket).toBeGreaterThanOrEqual(4);
  });

  it('b1: extra-turn floor fires correctly once tagger is ready (mocks return true)', () => {
    const etCards = ['Time Warp', 'Temporal Mastery', 'Walk the Aeons'];
    mockIsExtraTurn.mockImplementation((name: string) => etCards.includes(name));
    const r = estimateBracket(
      [...etCards, 'Forest'],
      undefined,
      3.5,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.extraTurnCount).toBe(3);
    // 3 extra turns → bracket-3 floor (sub-theme, not provable chaining)
    expect(r.hardFloors.some((f) => f.bracket === 3 && f.reason.includes('extra turn'))).toBe(true);
    expect(r.bracket).toBeGreaterThanOrEqual(3);
  });

  // b2: Counterspell undercount — counterspells whose primary role is not
  // 'removal' were invisible to interactionCount (audit P2 #6). The fix adds a
  // dedicated counterspells Set populated when hasTag(name, 'counterspell') &&
  // getCardRole(name) === null. Test with a realistic blue-control mix.
  it('b2: counterspells mixed with removal both count toward interactionCount signal', () => {
    const counters = ['Counterspell', 'Force of Will', 'Mana Drain'];
    const removal = ['Path to Exile', 'Swords to Plowshares'];
    const counterSet = new Set(counters);
    const removalSet = new Set(removal);
    // Counters: hasTag 'counterspell'=true, getCardRole=null (not tagged removal)
    // Removal: getCardRole='removal'
    mockHasTag.mockImplementation(
      (name: string, tag: string) => tag === 'counterspell' && counterSet.has(name)
    );
    mockGetRole.mockImplementation((name: string) => (removalSet.has(name) ? 'removal' : null));
    const r = estimateBracket(
      [...counters, ...removal, 'Forest'],
      undefined,
      3,
      undefined,
      { removal: removal.length, boardwipe: 0 }, // roleCounts from the tagger
      new Set()
    );
    // interactionCount = roleCounts.removal (2) + roleCounts.boardwipe (0) + counterspells (3) = 5
    expect(r.breakdown.interactionCount).toBe(5);
  });

  it('b2: counterspells also tagged removal are not double-counted (getCardRole guard)', () => {
    // If a card is tagged 'counterspell' AND getCardRole(name)='removal' (e.g.
    // a hybrid instant that counters/burns/draws), getCardRole !== null so the
    // counterspells dedup guard skips it. It's already captured in roleCounts.removal.
    const hybridCard = 'Izzet Charm';
    const pureCounters = ['Counterspell', 'Force of Will'];
    const taggedCounterspell = new Set([...pureCounters, hybridCard]);
    // Only the explicitly named cards are tagged counterspell (not Forest etc.)
    mockHasTag.mockImplementation(
      (name: string, tag: string) => tag === 'counterspell' && taggedCounterspell.has(name)
    );
    mockGetRole.mockImplementation((name: string) => (name === hybridCard ? 'removal' : null));
    const r = estimateBracket(
      [...pureCounters, hybridCard, 'Forest'],
      undefined,
      3,
      undefined,
      { removal: 1, boardwipe: 0 }, // hybridCard already in roleCounts.removal
      new Set()
    );
    // pureCounters (2) via counterspells Set + hybridCard in roleCounts.removal (1) = 3 total
    expect(r.breakdown.interactionCount).toBe(3);
  });

  // b3: STAX over-triggers on casual white — Thalia, Guardian of Thraben /
  // Esper Sentinel / Aven Mindcensor are common white hatebears that trip the
  // STAX/heavy signal in casual white decks (audit P2 #8). The fix excludes
  // single-bodied "spell-tax creatures" from STAX_PIECES. Even three of them
  // together should NOT trigger a bracket floor.
  it('b3: Thalia + Esper Sentinel + Aven Mindcensor are not stax pieces (casual white hatebears)', () => {
    const r = estimateBracket(
      ['Thalia, Guardian of Thraben', 'Esper Sentinel', 'Aven Mindcensor', 'Plains', 'Forest'],
      undefined,
      3,
      undefined,
      undefined,
      new Set()
    );
    // None of these should appear in the stax signal — they are hatebears, not lock pieces.
    expect(r.breakdown.staxPieceCount).toBe(0);
    expect(r.breakdown.staxPieceNames).not.toContain('Thalia, Guardian of Thraben');
    expect(r.breakdown.staxPieceNames).not.toContain('Esper Sentinel');
    expect(r.breakdown.staxPieceNames).not.toContain('Aven Mindcensor');
    // Without a stax floor, a casual white deck stays at Core (2).
    expect(r.hardFloors.find((f) => f.reason.includes('stax'))).toBeUndefined();
    expect(r.bracket).toBe(2);
  });

  it('b3: casual white hatebears + 2 real stax pieces stay below the 3-piece floor', () => {
    // Only genuinely lock/resource-denial pieces count toward the stax threshold.
    // Even with Thalia + Esper Sentinel + Aven Mindcensor, only the real lock
    // pieces (Winter Orb, Static Orb) count — so total = 2, below the 3-piece floor.
    const r = estimateBracket(
      [
        'Thalia, Guardian of Thraben',
        'Esper Sentinel',
        'Aven Mindcensor',
        'Winter Orb',
        'Static Orb',
        'Plains',
      ],
      undefined,
      3,
      undefined,
      undefined,
      new Set()
    );
    expect(r.breakdown.staxPieceCount).toBe(2); // only the 2 real lock pieces
    // 2 real stax pieces = below the 3-piece floor threshold
    expect(r.hardFloors.find((f) => f.reason.includes('stax'))).toBeUndefined();
    expect(r.bracket).toBe(2);
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
