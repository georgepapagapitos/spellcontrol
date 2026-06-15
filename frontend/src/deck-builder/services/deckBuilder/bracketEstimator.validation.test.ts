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
  completedCombos: Array<{ bracket: number | null; cardCount?: number; bracketTag?: string }>;
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
  // ── Bracket 2: Core (the default for power-neutral decks) ─────────────────
  // The estimator never auto-assigns Bracket 1 (Exhibition) — per the official RC
  // system, "the average current preconstructed deck is at a Core level" and
  // Exhibition is a deliberate theme-over-winning intent that card content alone
  // can't detect. So a deck with no power signals is Core (2), not Exhibition (1).
  // (A theme deck like Bear Tribal IS Exhibition in spirit, but the estimator can't
  // know that — it reads power, not intent — so it conservatively reports Core.)
  {
    name: 'Bear Tribal (theme, power-neutral)',
    expectedBracket: 2,
    sourceCitation:
      'RC: Bracket 2 Core is the baseline for power-neutral homebrews; Exhibition (1) ' +
      'is a theme-intent build the estimator cannot infer from cards.',
    notes:
      'Pure tribal — mid-curve creatures, almost no interaction, no GCs, no fast mana, ' +
      'no combos. Plays as Exhibition socially, but reads as Core to a power estimate.',
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
  // The canary for THIS fix (the "select bracket 2 → builds a bracket 1" bug): a
  // Core-pool precon shell with Sol Ring + a single Time Warp. No GCs, no chained
  // extra turns, no combos → Core (2). Previously mis-estimated as Exhibition (1).
  {
    name: 'Atraxa Superfriends precon-style (with Sol Ring + 1 Time Warp)',
    expectedBracket: 2,
    sourceCitation:
      'RC Feb 2026 update: precons decoupled from automatic Bracket 2 but remain Core in ' +
      'power; Sol Ring allowed in 1-2; extra turns: "one or two is fine" — only chaining restricted.',
    notes:
      'Tests three RC-alignment guarantees: (a) Sol Ring does not inflate fast-mana soft ' +
      'score, (b) a single Time Warp does not force a floor, and (c) a power-neutral precon ' +
      'shell estimates as Core (2), not Exhibition (1).',
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
  // A vanilla midrange homebrew — the most common real-world case, and the exact
  // shape an EDHREC "/core" pool produces. Moderate curve, real interaction, zero
  // power markers → Core (2). This is the deck the user requested at "bracket 2".
  {
    name: 'Generic midrange homebrew (core pool)',
    expectedBracket: 2,
    sourceCitation:
      'RC: Bracket 2 Core = "the average current preconstructed deck"; most self-built ' +
      'decks with no Game Changers and no combos land here.',
    notes:
      'avgCmc ~3.2, ~8 interaction pieces, no GCs/fast mana/combos/stax/extra turns. ' +
      'Soft score stays well below the promotion threshold → Core (2).',
    cards: ['Some Commander', ...n(62, 'Midrange Card'), ...n(37, 'Land')],
    averageCmc: 3.2,
    gameChangerNames: [],
    mldCards: [],
    extraTurnCards: [],
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
  // ── Bracket 4: Optimized stax-focused ────────────────────────────────────
  {
    name: 'Mono-W Stax (optimized)',
    expectedBracket: 4,
    sourceCitation:
      'RC Bracket 4: heavy stax / lock effects are accepted as a Bracket 4 strategy; ' +
      'they functionally parallel mass land denial in shutting down opponents.',
    notes:
      'Five canonical stax pieces (Winter Orb, Static Orb, Sphere of Resistance, Thorn ' +
      'of Amethyst, Smokestack). Exercises the 5+ stax-piece bracket-4 floor.',
    cards: [
      'Hokori, Dust Drinker',
      'Winter Orb',
      'Static Orb',
      'Sphere of Resistance',
      'Thorn of Amethyst',
      'Smokestack',
      'Thalia, Guardian of Thraben',
      ...n(20, 'Mono-W Creature'),
      ...n(7, 'Mana Rock'),
      ...n(10, 'Removal'),
      ...n(1, 'Boardwipe'),
      ...n(5, 'Card Draw'),
      ...n(36, 'Plains'),
    ],
    averageCmc: 2.8,
    gameChangerNames: [],
    mldCards: [],
    extraTurnCards: [],
    tutorCards: [],
    removalCount: 10,
    boardwipeCount: 1,
    completedCombos: [],
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
  // ── P0 regression: bare combo deck ───────────────────────────────────────
  // A deck with one 2-card infinite combo, no GCs, no fast mana → B3 minimum.
  // Before the fix this estimated B2 because combo.bracket was always null and
  // parseInt('unknown') = NaN caused the combo to be silently dropped.
  {
    name: 'Bare combo deck (one 2-card infinite, no GCs, no fast mana)',
    expectedBracket: 3,
    sourceCitation: 'Official RC: zero intentional 2-card infinite combos required for B2',
    notes: 'Verifies the P0 fix: a null-bracket 2-card combo must floor at B3, not B2.',
    cards: ['Forest', ...Array(97).fill('Plains')],
    averageCmc: 3.5,
    gameChangerNames: [],
    mldCards: [],
    extraTurnCards: [],
    tutorCards: [],
    removalCount: 2,
    boardwipeCount: 0,
    completedCombos: [{ bracket: null, cardCount: 2 }],
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
    cards: (c.cardCount ?? 2) <= 2 ? ['A', 'B'] : ['A', 'B', 'C'],
    results: ['Win'],
    isComplete: true,
    missingCards: [],
    deckCount: 1,
    bracket: c.bracket,
    bracketTag: c.bracketTag ?? null,
    cardCount: c.cardCount ?? 2,
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
