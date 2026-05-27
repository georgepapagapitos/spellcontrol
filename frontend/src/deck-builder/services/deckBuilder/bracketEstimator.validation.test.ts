/**
 * Reference-deck validation harness for the bracket estimator.
 *
 * Where the unit tests pin algorithm mechanics (one signal at a time), this
 * suite pins end-to-end output for representative decks across all five
 * brackets. The expectations come from how the official RC Commander Brackets
 * system (2025 beta, October 2025 update) classifies each deck shape:
 *
 *   - https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025
 *   - https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026
 *
 * The fixtures are representative (not literal 99-card precon lists). Each
 * captures the *signals* the algorithm uses — game-changer count, MLD,
 * extra-turn count, fast-mana density, tutor count, combo bracket, average
 * CMC, interaction count — at proportions that match a deck of that bracket.
 *
 * Why this matters: the algorithm's hard-floor + soft-score formula is a
 * proxy for "where would a Rule-Zero conversation place this deck?" These
 * fixtures are the calibration set. If a real-Magic refactor regresses one
 * of them, that's a signal worth investigating before merging.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectedCombo } from '@/deck-builder/types';

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

interface ReferenceDeck {
  name: string;
  expectedBracket: 1 | 2 | 3 | 4 | 5;
  sourceCitation: string;
  notes: string;
  cards: string[];
  averageCmc: number;
  gameChangerNames: string[];
  mldCards: string[];
  extraTurnCards: string[];
  /** Cards that should be detected as tutors (have `tutor` tag + cardDraw role). */
  tutorCards: string[];
  removalCount: number;
  boardwipeCount: number;
  completedCombos: Array<{ bracket: number }>;
}

/**
 * The current canonical Game Changers list is ~53 cards (as of Feb 2026).
 * We embed a representative subset here, sufficient to drive the fixtures.
 * In production, this comes live from Scryfall's `is:gamechanger` query.
 */
const GC_SUBSET = [
  'Cyclonic Rift',
  'Smothering Tithe',
  'Rhystic Study',
  'Mana Crypt',
  'Mana Vault',
  'Mox Diamond',
  'Vampiric Tutor',
  'Demonic Tutor',
  'Imperial Seal',
  'Thassa’s Oracle',
  'Trinisphere',
  'Drannith Magistrate',
  'Grim Monolith',
  'Jeweled Lotus',
];

function n(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

const REFERENCE_DECKS: ReferenceDeck[] = [
  // ── Bracket 1: Exhibition ────────────────────────────────────────────────
  {
    name: 'Bear Tribal (theme)',
    expectedBracket: 1,
    sourceCitation:
      'RC Bracket 1: ultra-casual, theme over power, no Game Changers, 9+ turns to win',
    notes:
      'Pure tribal — mid-curve creatures, almost no interaction, no GCs, no fast mana, no combos.',
    cards: [
      'Ayula, Queen Among Bears',
      ...n(60, 'Bear'),
      ...n(2, 'Removal Spell'),
      ...n(36, 'Forest'),
    ],
    averageCmc: 3.8,
    gameChangerNames: [],
    mldCards: [],
    extraTurnCards: [],
    tutorCards: [],
    removalCount: 2,
    boardwipeCount: 0,
    completedCombos: [],
  },
  // ── Bracket 1: Precon shell (post Feb 2026 decoupling) ───────────────────
  // RC's Feb 2026 update explicitly decoupled precons from Bracket 2 — a
  // precon shell with no obvious power-ups now sits in 1-or-2 territory.
  // Our static algorithm can't distinguish playstyle, so we conservatively
  // call it 1. This fixture is also the canary for the two RC-misalignment
  // bugs the parent PR fixes: Sol Ring as fast mana, and one extra turn
  // tripping the bracket-2 floor (RC: 1-2 extra turns is fine).
  {
    name: 'Atraxa Superfriends precon-style (with Sol Ring + 1 Time Warp)',
    expectedBracket: 1,
    sourceCitation:
      'RC Feb 2026 update: precons decoupled from Bracket 2. Sol Ring allowed in 1-2; ' +
      'extra turns: "one or two in the deck is fine" — only chaining is restricted.',
    notes:
      'Tests two former RC-misalignment bugs: (a) Sol Ring contributing to fast-mana ' +
      'soft score, and (b) a single Time Warp forcing the bracket-2 hard floor. ' +
      'Both are now corrected.',
    cards: [
      'Atraxa, Praetors’ Voice',
      'Sol Ring',
      'Arcane Signet',
      'Time Warp',
      ...n(9, 'Planeswalker'),
      ...n(25, 'Creature'),
      ...n(8, 'Mana Rock'),
      ...n(6, 'Removal'),
      ...n(2, 'Boardwipe'),
      ...n(10, 'Misc Utility'),
      ...n(37, 'Land'),
    ],
    averageCmc: 3.4,
    gameChangerNames: [],
    mldCards: [],
    extraTurnCards: ['Time Warp'],
    tutorCards: [],
    removalCount: 6,
    boardwipeCount: 2,
    completedCombos: [],
  },
  // ── Bracket 3: Upgraded ──────────────────────────────────────────────────
  {
    name: 'Upgraded Superfriends',
    expectedBracket: 3,
    sourceCitation:
      'RC Bracket 3: up to 3 GCs, strong synergy, late-game combos OK, 6+ turns to win',
    notes: 'Precon shell + 2 Game Changers + 1 late-game combo (CS bracket 3).',
    cards: [
      'Atraxa, Praetors’ Voice',
      'Sol Ring',
      'Arcane Signet',
      'Smothering Tithe', // GC
      'Cyclonic Rift', // GC
      'Doubling Season',
      'Teferi, Hero of Dominaria',
      ...n(8, 'Planeswalker'),
      ...n(22, 'Creature'),
      ...n(6, 'Mana Rock'),
      ...n(8, 'Removal'),
      ...n(2, 'Boardwipe'),
      ...n(8, 'Misc Utility'),
      ...n(37, 'Land'),
    ],
    averageCmc: 3.2,
    gameChangerNames: ['Smothering Tithe', 'Cyclonic Rift'],
    mldCards: [],
    extraTurnCards: [],
    tutorCards: [],
    removalCount: 8,
    boardwipeCount: 2,
    completedCombos: [{ bracket: 3 }],
  },
  // ── Bracket 4: Optimized (non-cEDH) ──────────────────────────────────────
  {
    name: 'Yuriko ninja-tempo (optimized)',
    expectedBracket: 4,
    sourceCitation:
      'RC Bracket 4: lethal & consistent, no GC limit, MLD OK, early combos OK, ' +
      '4+ turns to win',
    notes:
      'Multiple GCs, MLD piece, early-game combo, low curve, heavy interaction. ' +
      'High-power deck that is not cEDH-metagame adherent.',
    cards: [
      'Yuriko, the Tiger’s Shadow',
      'Mana Crypt', // GC + fast mana
      'Vampiric Tutor', // GC
      'Demonic Tutor', // GC
      'Mox Diamond', // GC + fast mana
      'Armageddon', // MLD
      'Thassa’s Oracle', // GC
      'Demonic Consultation', // combo piece
      ...n(20, 'Cheap Evasive Creature'),
      ...n(6, 'Mana Rock'),
      ...n(14, 'Removal'),
      ...n(1, 'Boardwipe'),
      ...n(12, 'Card Draw'),
      ...n(36, 'Land'),
    ],
    averageCmc: 2.5,
    gameChangerNames: [
      'Mana Crypt',
      'Vampiric Tutor',
      'Demonic Tutor',
      'Mox Diamond',
      'Thassa’s Oracle',
    ],
    mldCards: ['Armageddon'],
    extraTurnCards: [],
    tutorCards: ['Vampiric Tutor', 'Demonic Tutor'],
    removalCount: 14,
    boardwipeCount: 1,
    completedCombos: [{ bracket: 4 }],
  },
  // ── Bracket 5: cEDH ──────────────────────────────────────────────────────
  {
    name: 'Thoracle cEDH',
    expectedBracket: 5,
    sourceCitation: 'RC Bracket 5: meticulously tuned for cEDH metagame, can end on any turn',
    notes:
      'Thoracle + Demonic Consultation + Tainted Pact dual win condition. ' +
      'Saturated GCs, very low curve, heavy fast mana + tutor density, multiple ' +
      'early combos. This is the prototypical cEDH shape.',
    cards: [
      'Kinnan, Bonder Prodigy',
      // Fast mana (post-fix Sol Ring is excluded — leaving 6 real fast-mana pieces)
      'Mana Crypt',
      'Mana Vault',
      'Mox Diamond',
      'Lotus Petal',
      'Chrome Mox',
      'Jeweled Lotus',
      // Game changers
      'Vampiric Tutor',
      'Demonic Tutor',
      'Imperial Seal',
      'Cyclonic Rift',
      'Rhystic Study',
      'Smothering Tithe',
      'Grim Monolith',
      'Trinisphere',
      'Drannith Magistrate',
      // Combo win pieces
      'Thassa’s Oracle',
      'Demonic Consultation',
      'Tainted Pact',
      // More tutors (creature-typed but tagger primary role is cardDraw in this test)
      'Mystical Tutor',
      'Worldly Tutor',
      ...n(15, 'Cheap Interaction'),
      ...n(8, 'Card Draw'),
      ...n(15, 'Creature'),
      ...n(31, 'Land'),
    ],
    averageCmc: 1.9,
    gameChangerNames: [
      'Mana Crypt',
      'Mox Diamond',
      'Vampiric Tutor',
      'Demonic Tutor',
      'Imperial Seal',
      'Cyclonic Rift',
      'Rhystic Study',
      'Smothering Tithe',
      'Grim Monolith',
      'Trinisphere',
      'Drannith Magistrate',
      'Thassa’s Oracle',
      'Jeweled Lotus',
    ],
    mldCards: [],
    extraTurnCards: [],
    tutorCards: ['Vampiric Tutor', 'Demonic Tutor', 'Imperial Seal', 'Mystical Tutor'],
    removalCount: 15,
    boardwipeCount: 0,
    completedCombos: [{ bracket: 5 }, { bracket: 4 }],
  },
];

function runFixture(deck: ReferenceDeck) {
  mockHasTag.mockImplementation(
    (name: string, tag: string) => tag === 'tutor' && deck.tutorCards.includes(name)
  );
  mockIsMLD.mockImplementation((name: string) => deck.mldCards.includes(name));
  mockIsExtraTurn.mockImplementation((name: string) => deck.extraTurnCards.includes(name));
  mockGetRole.mockImplementation((name: string) =>
    deck.tutorCards.includes(name) ? 'cardDraw' : null
  );

  const combos: DetectedCombo[] = deck.completedCombos.map((c, i) => ({
    comboId: `${deck.name}-combo-${i}`,
    cards: ['A', 'B'],
    results: ['Win'],
    isComplete: true,
    missingCards: [],
    deckCount: 1,
    bracket: String(c.bracket),
  }));

  return estimateBracket(
    deck.cards,
    combos,
    deck.averageCmc,
    undefined,
    { removal: deck.removalCount, boardwipe: deck.boardwipeCount },
    new Set([...GC_SUBSET, ...deck.gameChangerNames])
  );
}

describe('estimateBracket — reference decks', () => {
  beforeEach(() => {
    mockHasTag.mockReset().mockReturnValue(false);
    mockIsMLD.mockReset().mockReturnValue(false);
    mockIsExtraTurn.mockReset().mockReturnValue(false);
    mockGetRole.mockReset().mockReturnValue(null);
  });

  for (const deck of REFERENCE_DECKS) {
    it(`${deck.name} → bracket ${deck.expectedBracket}`, () => {
      const result = runFixture(deck);
      expect(result.bracket, `expected ${deck.expectedBracket}, got ${result.bracket}`).toBe(
        deck.expectedBracket
      );
    });
  }
});
