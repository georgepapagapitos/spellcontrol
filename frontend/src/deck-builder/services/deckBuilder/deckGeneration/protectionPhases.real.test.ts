// @vitest-environment node
//
// E563: the generation phases that protect a card from eviction read the same
// wide protection predicate (`readsAsProtection`) the report and the deck
// objective read, not the tagger's one-sentence `isProtectionPiece`. Oracle
// text is Scryfall's, verbatim; nothing from the tagger client is mocked. In
// Sythis partial50 the combo audit cut Solitary Confinement (33%) for Siona.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import { isProtectionPiece, readsAsProtection } from '@/deck-builder/services/tagger/client';
import { comboIntegrityAuditPhase } from './phaseComboAudit';
import type { GenerationState } from './state';

function real(name: string, type_line: string, oracle_text: string, cmc = 2): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc,
    type_line,
    oracle_text,
    color_identity: ['U'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  };
}

const SNAKESKIN = real(
  'Snakeskin Veil',
  'Instant',
  "Put a +1/+1 counter on target creature you control. It gains hexproof until end of turn. (It can't be the target of spells or abilities your opponents control.)",
  1
);
const FLICKERING_WARD = real(
  'Flickering Ward',
  'Enchantment — Aura',
  `Enchant creature
As Flickering Ward enters, choose a color.
Enchanted creature has protection from the chosen color. This effect doesn't remove Flickering Ward.
{W}: Change Flickering Ward's chosen color.`
);
const SOLITARY = real(
  'Solitary Confinement',
  'Enchantment',
  `At the beginning of your upkeep, sacrifice Solitary Confinement unless you discard a card.
Skip your draw step.
Skip all combat phases of your turns.
You have shroud.
Damage that would be dealt to you is prevented.`,
  3
);
const FILLER = real('Filler', 'Creature — Human', 'Flying');

function combo(cards: string[], missingCards: string[]): DetectedCombo {
  return {
    comboId: 'c1',
    cards,
    results: [],
    isComplete: false,
    missingCards,
    deckCount: 500,
    bracket: 3,
    bracketTag: null,
    cardCount: cards.length,
  };
}

interface AuditDeck {
  /** Cards in the deck with their page inclusion; two incomplete combos need `enabler`. */
  cards: Array<[ScryfallCard, number]>;
  enabler?: ScryfallCard;
  enablerInclusion?: number;
  gameChangers?: string[];
}

/** Runs the combo audit on a deck holding PieceA and PieceB (50%) plus `cards`,
 *  with two incomplete combos the enabler (80% unless stated) completes. */
function auditRun(deck: AuditDeck) {
  const pieceA = real('PieceA', 'Creature — Human', 'Flying');
  const pieceB = real('PieceB', 'Creature — Human', 'Flying');
  const enabler = deck.enabler ?? real('Enabler', 'Creature — Human', 'Flying');
  const inclusion = new Map<string, number>([
    ['PieceA', 50],
    ['PieceB', 50],
    [enabler.name, deck.enablerInclusion ?? 80],
    ...deck.cards.map(([c, inc]) => [c.name, inc] as [string, number]),
  ]);
  const held = deck.cards.map(([c]) => c);
  const state = {
    context: {
      commander: real('Commander', 'Legendary Creature — Human', ''),
      partnerCommander: null,
      colorIdentity: ['U'],
      customization: { mustIncludeCards: [], tempMustIncludeCards: [] },
    },
    cfg: {
      maxCardPrice: null,
      currency: 'USD',
      collectionStrategy: 'full',
      comboCountSetting: 1,
    },
    usedNames: new Set(['PieceA', 'PieceB', ...held.map((c) => c.name)]),
    bannedCards: new Set<string>(),
    categories: {
      lands: [],
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: [pieceA, pieceB],
      synergy: held,
      utility: [],
    },
    currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
    currentSubtypeCounts: {},
    mustIncludeNames: [],
    combos: [],
    gameChangerNames: new Set<string>(deck.gameChangers ?? []),
    comboCardNames: new Set<string>(),
    edhrecData: {
      cardlists: {
        allNonLand: [...inclusion].map(([name, inc]) => ({ name, id: name, inclusion: inc })),
      },
    },
  } as unknown as GenerationState;
  const { repairs } = comboIntegrityAuditPhase(state, {
    detectedCombos: [
      combo(['PieceA', enabler.name], [enabler.name]),
      combo(['PieceB', enabler.name], [enabler.name]),
    ],
    scryfallCardMap: new Map([[enabler.name, enabler]]),
    budgetTracker: null,
    bracketGuard: undefined,
  });
  return { repairs, state };
}

/** The weakest card by inclusion is `protectedCard` (1%); Filler (5%) is next. */
function auditCut(protectedCard: ScryfallCard): string | undefined {
  return auditRun({
    cards: [
      [protectedCard, 1],
      [FILLER, 5],
    ],
  }).repairs[0]?.cut;
}

describe('the wide protection reading reaches the eviction phases', () => {
  it.each([
    ['Snakeskin Veil', SNAKESKIN],
    ['Flickering Ward', FLICKERING_WARD],
    ['Solitary Confinement', SOLITARY],
  ])('%s reads as protection, which the tagger evidence alone does not', (_n, c) => {
    expect(isProtectionPiece(c)).toBe(false);
    expect(readsAsProtection(c)).toBe(true);
  });

  it.each([
    ['Snakeskin Veil', SNAKESKIN],
    ['Flickering Ward', FLICKERING_WARD],
    ['Solitary Confinement', SOLITARY],
  ])('the combo audit cuts the filler, not %s, though it is the weakest', (_n, c) => {
    expect(auditCut(c)).toBe('Filler');
  });

  it('still cuts the weakest card when it is not protection', () => {
    expect(auditCut(real('Plain Bear', 'Creature — Bear', 'Trample'))).toBe('Plain Bear');
  });

  it('does not read a keyword the text takes away, or a bare self-clause, as protection', () => {
    const smite = real(
      'Smite the Deathless',
      'Instant',
      'Smite the Deathless deals 3 damage to target creature. That creature loses indestructible until end of turn. If that creature would die this turn, exile it instead.'
    );
    const progenitus = real(
      'Progenitus',
      'Legendary Creature — Hydra Avatar',
      "Protection from everything\nIf Progenitus would be put into a graveyard from anywhere, reveal Progenitus and shuffle it into its owner's library instead.",
      10
    );
    // A one-turn "you gain protection from everything" on a card draw engine
    // kept a $115 card over staples in five live decks.
    const ring = real(
      'The One Ring',
      'Legendary Artifact',
      `Indestructible
When The One Ring enters, if you cast it, you gain protection from everything until your next turn.
At the beginning of your upkeep, you lose 1 life for each burden counter on The One Ring.
{T}: Put a burden counter on The One Ring, then draw a card for each burden counter on The One Ring.`,
      4
    );
    expect(readsAsProtection(ring)).toBe(false);
    expect(readsAsProtection(smite)).toBe(false);
    expect(readsAsProtection(progenitus)).toBe(false);
  });
});

// The Sythis partial50 regression: once Solitary Confinement read as
// protection, the audit's lowest unprotected card completing Siona was
// Enlightened Tutor (40.3%, a Game Changer). A cut never takes a staple, a
// tutor, a Game Changer (for a non-Game Changer) or a piece of another line.
const ENLIGHTENED_TUTOR = real(
  'Enlightened Tutor',
  'Instant',
  'Search your library for an artifact or enchantment card, reveal that card, then shuffle and put the card on top.',
  1
);
const SIONA = real(
  'Siona, Captain of the Pyleas',
  'Legendary Creature — Human Warrior',
  'Vigilance\nWhenever Siona, Captain of the Pyleas or another Human enters, you gain 1 life.',
  3
);

describe('a combo completion never cuts what the deck keeps (E563)', () => {
  const siona = (deck: Omit<AuditDeck, 'enabler' | 'enablerInclusion'>) =>
    auditRun({ ...deck, enabler: SIONA, enablerInclusion: 20 });

  it('makes no cut when every card left is a staple or protection, and the combo stays one-away', () => {
    const { repairs, state } = siona({
      cards: [
        [SOLITARY, 33.2],
        [ENLIGHTENED_TUTOR, 40.3],
      ],
      gameChangers: ['Enlightened Tutor'],
    });
    expect(repairs).toEqual([]);
    expect(state.usedNames.has('Enlightened Tutor')).toBe(true);
    expect(state.usedNames.has('Solitary Confinement')).toBe(true);
    expect(state.usedNames.has(SIONA.name)).toBe(false);
  });

  it('cuts filler instead when there is some', () => {
    const { repairs } = siona({
      cards: [
        [SOLITARY, 33.2],
        [ENLIGHTENED_TUTOR, 40.3],
        [FILLER, 12],
      ],
      gameChangers: ['Enlightened Tutor'],
    });
    expect(repairs).toEqual([expect.objectContaining({ cut: 'Filler', added: SIONA.name })]);
  });

  it('keeps a Game Changer below the staple bar, unless a Game Changer comes in', () => {
    const cards: Array<[ScryfallCard, number]> = [
      [ENLIGHTENED_TUTOR, 10],
      [SOLITARY, 33.2],
    ];
    expect(siona({ cards, gameChangers: ['Enlightened Tutor'] }).repairs).toEqual([]);
    expect(siona({ cards, gameChangers: ['Enlightened Tutor', SIONA.name] }).repairs).toEqual([
      expect.objectContaining({ cut: 'Enlightened Tutor' }),
    ]);
  });
});

// The structural half: a phase that protects a piece from eviction reads
// `readsAsProtection`. The only generation readers of the narrow tagger
// evidence are listed here, each for a stated reason.
describe('no generation phase reads the narrow evidence', () => {
  const ALLOWED = new Set([
    // E532 pick-time promotion: promotes a survival piece into the deck, and
    // asks that it keep a permanent alive; widening it would promote Solitary
    // Confinement into voltron decks.
    'protectionPicks.ts',
  ]);
  it('every phase module reads readsAsProtection', () => {
    const offenders = readdirSync(__dirname)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !ALLOWED.has(f))
      .filter((f) => {
        const code = readFileSync(join(__dirname, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
        return /\bisProtectionPiece\(/.test(code);
      });
    expect(offenders).toEqual([]);
  });

  // The cut sites of a combo completion or repair keep staples, tutors, Game
  // Changers and combo-line pieces (evictionKeeper.ts).
  it.each([
    'phaseComboAudit',
    'phaseApplyComboFloor',
    'phaseCoherenceRepair',
    'phaseBracketConverge',
  ])('%s reads evictionKeeper', (phase) => {
    expect(readFileSync(join(__dirname, `${phase}.ts`), 'utf8')).toContain("'./evictionKeeper'");
  });
});
