import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildInclusionIndex,
  lookupInclusion,
  buildCardInclusionMap,
  comboMatchesToDetected,
  computeGradeAndBracket,
  buildStrategyEngineInput,
  computeRoleCounts,
} from './commanderDeckAnalysis';
import * as taggerClient from '@/deck-builder/services/tagger/client';
import type { DeckSynergy } from '../synergy/deckSynergy';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import type { ComboMatchResponse } from '@/types/combos';

function edhrec(): EDHRECCommanderData {
  const card = (name: string, inclusion: number) => ({
    name,
    sanitized: name,
    primary_type: 'Creature',
    inclusion,
    num_decks: 0,
  });
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 0,
      deckSize: 99,
      manaCurve: {},
      typeDistribution: {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 0,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 10, nonbasic: 27, total: 37 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [card('Command Tower', 80), card('Plains', 99)],
      allNonLand: [card('Sol Ring', 90), card('Cultivate // Back', 40)],
    },
    similarCommanders: [],
  };
}

describe('buildInclusionIndex / lookupInclusion', () => {
  it('indexes non-land cards and non-basic lands, skipping basics', () => {
    const idx = buildInclusionIndex(edhrec());
    expect(idx.get('Sol Ring')).toBe(90);
    expect(idx.get('Command Tower')).toBe(80);
    // Basic land excluded from the inclusion index
    expect(idx.has('Plains')).toBe(false);
  });

  it('falls back to the front face for DFC names', () => {
    const idx = buildInclusionIndex(edhrec());
    expect(lookupInclusion(idx, 'Cultivate // Back')).toBe(40);
    // A bare front-face name not itself indexed has no entry
    expect(lookupInclusion(idx, 'Cultivate')).toBeUndefined();
    // ...but a DFC whose front face IS indexed resolves via the front face
    expect(lookupInclusion(idx, 'Sol Ring // X')).toBe(90);
  });
});

describe('buildCardInclusionMap', () => {
  it('maps known cards, zero-fills unknowns, and skips basics', () => {
    const map = buildCardInclusionMap(edhrec(), ['Sol Ring', 'Unknown Card', 'Plains']);
    expect(map['Sol Ring']).toBe(90);
    expect(map['Unknown Card']).toBe(0);
    expect(map).not.toHaveProperty('Plains');
  });
});

describe('comboMatchesToDetected', () => {
  it('maps only inDeck combos as complete with numeric bracket and cardCount', () => {
    const resp: ComboMatchResponse = {
      inDeck: [
        {
          combo: {
            id: 'c1',
            identity: 'WU',
            produces: ['Infinite mana'],
            prerequisites: null,
            description: null,
            manaNeeded: null,
            popularity: 1234,
            cardCount: 2,
            bracket: 4,
            cards: [
              { oracleId: 'o1', cardName: 'Card A', quantity: 1 },
              { oracleId: 'o2', cardName: 'Card B', quantity: 1 },
            ],
          },
          presentOracleIds: ['o1', 'o2'],
          missingOracleIds: [],
        },
      ],
      oneAway: [
        {
          combo: {
            id: 'c2',
            identity: 'B',
            produces: ['Win'],
            prerequisites: null,
            description: null,
            manaNeeded: null,
            popularity: 5,
            cardCount: 2,
            bracket: null,
            cards: [{ oracleId: 'o3', cardName: 'Card C', quantity: 1 }],
          },
          presentOracleIds: ['o3'],
          missingOracleIds: ['o4'],
        },
      ],
      almostInCollection: [],
    };
    const detected = comboMatchesToDetected(resp);
    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({
      comboId: 'c1',
      cards: ['Card A', 'Card B'],
      isComplete: true,
      missingCards: [],
      bracket: 4,
      cardCount: 2,
      deckCount: 1234,
    });
    expect(comboMatchesToDetected(null)).toEqual([]);
  });

  // b1: bracketTag must be threaded through comboMatchesToDetected so the
  // estimator can detect R-tagged (fast/ruthless) combos that auto-escalate to
  // Bracket 4 even without high acceleration. If bracketTag is dropped here the
  // R-tag signal silently disappears for manual decks (audit P1 #4 + ingest fix).
  it('b1: threads bracketTag from the combo response into DetectedCombo', () => {
    const resp: ComboMatchResponse = {
      inDeck: [
        {
          combo: {
            id: 'fast-1',
            identity: 'BR',
            produces: ['Win the game'],
            prerequisites: null,
            description: null,
            manaNeeded: null,
            popularity: 800,
            cardCount: 2,
            bracket: 4,
            bracketTag: 'R', // Ruthless — fast/infinite-turns combo
            cards: [
              { oracleId: 'x1', cardName: 'Hulk', quantity: 1 },
              { oracleId: 'x2', cardName: 'Flash', quantity: 1 },
            ],
          },
          presentOracleIds: ['x1', 'x2'],
          missingOracleIds: [],
        },
        {
          combo: {
            id: 'slow-1',
            identity: 'G',
            produces: ['Infinite mana'],
            prerequisites: null,
            description: null,
            manaNeeded: null,
            popularity: 200,
            cardCount: 2,
            bracket: 3,
            bracketTag: 'P', // Powerful — late-game 2-card
            cards: [
              { oracleId: 'y1', cardName: 'Selvala', quantity: 1 },
              { oracleId: 'y2', cardName: 'Umbral Mantle', quantity: 1 },
            ],
          },
          presentOracleIds: ['y1', 'y2'],
          missingOracleIds: [],
        },
      ],
      oneAway: [],
      almostInCollection: [],
    };
    const detected = comboMatchesToDetected(resp);
    expect(detected).toHaveLength(2);
    // R-tag must survive the mapping so estimateBracket can use it for B4 escalation.
    expect(detected.find((c) => c.comboId === 'fast-1')?.bracketTag).toBe('R');
    // P-tag must survive too (no auto-escalation, but tracked for future use).
    expect(detected.find((c) => c.comboId === 'slow-1')?.bracketTag).toBe('P');
  });

  it('b1: null bracketTag from the DB (pre-ingest) is preserved as null — not coerced', () => {
    // Before a re-ingest populates bracket_tag, the DB column is NULL. The estimator
    // must receive null (not undefined/missing) so it can distinguish "not tagged" from
    // "field absent". The combo 2-card count path still fires correctly (bracketTag
    // is only a secondary signal; the primary floor is twoCardComboCount > 0).
    const resp: ComboMatchResponse = {
      inDeck: [
        {
          combo: {
            id: 'untagged',
            identity: 'WU',
            produces: ['Infinite turns'],
            prerequisites: null,
            description: null,
            manaNeeded: null,
            popularity: 100,
            cardCount: 2,
            bracket: null,
            bracketTag: null, // pre-ingest NULL
            cards: [
              { oracleId: 'z1', cardName: 'Time Walk', quantity: 1 },
              { oracleId: 'z2', cardName: 'Narset', quantity: 1 },
            ],
          },
          presentOracleIds: ['z1', 'z2'],
          missingOracleIds: [],
        },
      ],
      oneAway: [],
      almostInCollection: [],
    };
    const detected = comboMatchesToDetected(resp);
    expect(detected[0].bracketTag).toBeNull();
    expect(detected[0].cardCount).toBe(2);
    expect(detected[0].bracket).toBeNull();
  });
});

describe('computeGradeAndBracket', () => {
  const card = (name: string, cmc = 2): ScryfallCard =>
    ({ name, cmc, type_line: 'Creature' }) as ScryfallCard;

  it('always returns a bracket; omits grade without edhrec/roleTargets', () => {
    const { bracketEstimation, deckGrade } = computeGradeAndBracket({
      allCardNames: ['Sol Ring', 'Llanowar Elves'],
      averageCmc: 2,
      gameChangerNames: new Set<string>(),
      allCards: [card('Sol Ring', 1), card('Llanowar Elves', 1)],
      roleCounts: { ramp: 2, removal: 0, boardwipe: 0, cardDraw: 0 },
      deckSize: 99,
    });
    expect(bracketEstimation.bracket).toBeGreaterThanOrEqual(1);
    expect(bracketEstimation.bracket).toBeLessThanOrEqual(5);
    expect(deckGrade).toBeUndefined();
  });

  it('produces a grade when edhrec data and role targets are present', () => {
    const cards = [card('Sol Ring', 1), card('Cultivate', 3)];
    const { deckGrade } = computeGradeAndBracket({
      allCardNames: cards.map((c) => c.name),
      averageCmc: 2,
      gameChangerNames: new Set<string>(),
      allCards: cards,
      roleCounts: { ramp: 2, removal: 0, boardwipe: 0, cardDraw: 0 },
      roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
      edhrecData: edhrec(),
      deckSize: 99,
    });
    expect(deckGrade).toBeDefined();
    expect(typeof deckGrade?.letter).toBe('string');
    expect(typeof deckGrade?.headline).toBe('string');
  });

  it('forwards over-target roles as deckGrade.trims instead of discarding them (C1)', () => {
    const cards = [card('Sol Ring', 1), card('Cultivate', 3)];
    // ramp: 25 vs a 10 target — well past the analyzer's own current>target+2
    // excess threshold. Previously computeGradeAndBracket only kept
    // {letter, headline} from getDeckSummaryData, discarding this.
    const { deckGrade } = computeGradeAndBracket({
      allCardNames: cards.map((c) => c.name),
      averageCmc: 2,
      gameChangerNames: new Set<string>(),
      allCards: cards,
      roleCounts: { ramp: 25, removal: 8, boardwipe: 3, cardDraw: 10 },
      roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
      edhrecData: edhrec(),
      deckSize: 99,
    });
    expect(deckGrade?.trims).toBeDefined();
    expect(deckGrade?.trims?.some((t) => t.label.toLowerCase() === 'ramp')).toBe(true);
    expect(deckGrade?.headline.toLowerCase()).toContain('ramp');
  });

  // E78 item 3: a role over target+tolerance was praised as "well-covered"/
  // "Strong" AND flagged "overbuilt" in the same headline — strongRoles was a
  // superset of the overbuilt set instead of excluding it. Reproduces the
  // live Kozilek shape: every one of the 4 roles is simultaneously >= target
  // and past isRoleExcess's threshold.
  it('never calls an overbuilt role "well-covered" or "Strong" in the same headline', () => {
    const cards = [card('Sol Ring', 1), card('Cultivate', 3)];
    const { deckGrade } = computeGradeAndBracket({
      allCardNames: cards.map((c) => c.name),
      averageCmc: 4,
      gameChangerNames: new Set<string>(),
      allCards: cards,
      roleCounts: { ramp: 20, removal: 16, boardwipe: 5, cardDraw: 8 },
      roleTargets: { ramp: 14, removal: 12, boardwipe: 3, cardDraw: 6 },
      edhrecData: edhrec(),
      deckSize: 99,
    });
    expect(deckGrade?.headline).not.toMatch(/well-covered/i);
    expect(deckGrade?.headline).not.toMatch(/^Strong/);
    expect(deckGrade?.headline.toLowerCase()).toContain('overbuilt');
  });
});

describe('buildStrategyEngineInput', () => {
  const c = (name: string) => ({ name, reason: '' });

  it('distils the primary invested axis + distinct engine cards', () => {
    const synergy: DeckSynergy = {
      axes: [
        {
          axis: 'tokens',
          label: 'Tokens / go-wide',
          producers: [c('A'), c('B')],
          payoffs: [c('C')], // A,B,C distinct → 3 engine cards
          total: 3,
        },
        { axis: 'lifegain', label: 'Lifegain', producers: [c('A')], payoffs: [], total: 1 },
      ],
      invested: ['tokens'],
      warnings: [],
      headline: '',
    };
    const input = buildStrategyEngineInput(synergy, 60);
    expect(input).toEqual({
      primaryLabel: 'Tokens / go-wide',
      primaryProducers: 2,
      primaryPayoffs: 1,
      engineCards: 3,
      nonLandCount: 60,
    });
  });

  it('returns a null primaryLabel when nothing is invested', () => {
    const synergy: DeckSynergy = { axes: [], invested: [], warnings: [], headline: '' };
    expect(buildStrategyEngineInput(synergy, 50).primaryLabel).toBeNull();
  });
});

describe('computeRoleCounts (iter-3 cluster 6 — single source for shipped roleCounts)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('excludes a land from role counts even when the tagger has it role-tagged', () => {
    // Reproduces the Ur-Dragon case: a land carries a role tag (e.g. a
    // removal-tagged utility land), but the shared recount must still skip it
    // by type line — the same "roles never count lands" rule the ad-hoc
    // `currentRoleCounts` incremental tally forgot at three call sites.
    // computeRoleCounts consumes validateCardRole (E77 iter-4 round 2) — spy on
    // that, not the raw getCardRole it wraps: validateCardRole calls getCardRole
    // via a same-module internal reference, which a spy on the export binding
    // doesn't intercept.
    vi.spyOn(taggerClient, 'validateCardRole').mockImplementation((card: { name: string }) =>
      card.name === 'Tainted Land'
        ? 'removal'
        : card.name === 'Real Removal Spell'
          ? 'removal'
          : null
    );

    const { roleCounts } = computeRoleCounts([
      { name: 'Tainted Land', type_line: 'Land' },
      { name: 'Real Removal Spell', type_line: 'Instant' },
    ]);

    expect(roleCounts.removal).toBe(1); // only the non-land removal-tagged card counts
  });

  // E78 item 8: a transforming card's back face (e.g. Elesh Norn // The
  // Argent Etchings' Saga chapter III "Destroy all other permanents...")
  // shouldn't credit its front face (a damage-punisher static with zero
  // wipe text) as a board wipe — the report-side recount checks the front
  // face only, unlike validateCardRole's default of joining every face
  // (which stays face-joining because it also drives live generation
  // picking, where a back-face-only signal is intentional).
  it('validates a DFC role against its front face only, not the joined text', () => {
    vi.spyOn(taggerClient, 'validateCardRole').mockImplementation(
      (card: { oracle_text?: string }) =>
        card.oracle_text?.includes('Destroy all') ? 'boardwipe' : null
    );

    const { roleCounts } = computeRoleCounts([
      {
        name: 'Elesh Norn // The Argent Etchings',
        type_line: 'Legendary Creature — Phyrexian Praetor // Enchantment — Saga',
        card_faces: [
          { type_line: 'Legendary Creature — Phyrexian Praetor', oracle_text: 'Vigilance' },
          {
            type_line: 'Enchantment — Saga',
            oracle_text:
              'III — Destroy all other permanents except for artifacts, lands, and Phyrexians.',
          },
        ],
      },
    ]);

    expect(roleCounts.boardwipe).toBe(0);
  });
});
