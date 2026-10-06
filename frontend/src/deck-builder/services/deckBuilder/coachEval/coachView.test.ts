import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EDHRECCombo, GapAnalysisCard } from '@/deck-builder/types';
import type { CommanderDeckAnalysisResult } from '../commanderDeckAnalysis';
import {
  card,
  COMMANDER,
  loadTaggerSnapshot,
  NONBASIC_LANDS,
  SPELLS,
} from '../__fixtures__/invariant-deck';
import { buildCoachView, combosFromEdhrec, ownershipByName } from './coachView';

beforeAll(loadTaggerSnapshot);
afterAll(() => vi.unstubAllGlobals());

// Real EDHREC combo rows: Krenko's Skirk Prospector line, and the Hullbreaker
// Horror + Sol Ring + Mox Amber loop a Sivitri gate differ named.
const KRENKO_COMBO: EDHRECCombo = {
  comboId: '38-659-1288',
  cards: [
    { name: 'Skirk Prospector', id: 'a' },
    { name: 'Goblin Warchief', id: 'b' },
    { name: 'Krenko, Mob Boss', id: 'c' },
  ],
  results: ['Infinite creature tokens with haste'],
  deckCount: 35316,
  rank: 1,
  bracket: null,
  prereqCount: 0,
  cardCount: 3,
  href: null,
};
const HULLBREAKER: EDHRECCombo = {
  comboId: '1206-3120-5037',
  cards: [
    { name: 'Hullbreaker Horror', id: 'a' },
    { name: 'Sol Ring', id: 'b' },
    { name: 'Mox Amber', id: 'c' },
  ],
  results: ['Infinite colorless mana', 'Infinite storm count'],
  deckCount: 812,
  rank: 3,
  bracket: 4,
  prereqCount: 1,
  cardCount: 3,
  href: null,
};

describe('combosFromEdhrec', () => {
  it('splits a commander page combo list into complete and one-card-short', () => {
    const full = combosFromEdhrec(
      [KRENKO_COMBO],
      ['Krenko, Mob Boss', 'Skirk Prospector', 'Goblin Warchief']
    );
    expect(full.inDeck).toHaveLength(1);
    expect(full.oneAway).toHaveLength(0);
    const short = combosFromEdhrec(
      [KRENKO_COMBO, HULLBREAKER],
      ['Krenko, Mob Boss', 'Skirk Prospector']
    );
    expect(short.inDeck).toHaveLength(0);
    expect(short.oneAway.map((m) => m.missingOracleIds)).toEqual([['Goblin Warchief']]);
  });
});

describe('ownershipByName', () => {
  it('owns by name, case-insensitively, and a DFC by its front face', () => {
    const own = ownershipByName(new Set(['Rhystic Study', 'Esika, God of the Tree']));
    expect(own('rhystic study')).toBe('owned');
    expect(own('Esika, God of the Tree // The Prismatic Bridge')).toBe('owned');
    expect(own('Mystic Remora')).toBe('unowned');
  });
});

function gap(name: string, inclusion: number, role: string): GapAnalysisCard {
  return { name, inclusion, synergy: 0.1, role, typeLine: '', price: null };
}

function tatyova() {
  const cards = [...SPELLS, ...NONBASIC_LANDS].map((n) => card(n));
  while (cards.length < 99) cards.push(card(cards.length % 2 ? 'Forest' : 'Island'));
  return cards;
}

function analysis(): CommanderDeckAnalysisResult {
  return {
    bracketEstimation: { bracket: 2 },
    roleTargets: { ramp: 12, removal: 8, boardwipe: 2, cardDraw: 10 },
    gapAnalysis: [
      gap('Rhystic Study', 41, 'cardDraw'),
      gap('Fact or Fiction', 30, 'cardDraw'),
      gap('Burgeoning', 22, 'ramp'),
    ],
    hiddenGems: [],
    cardInclusionMap: {},
    // The hero only names a combo piece this commander's decks play.
    suggestionCards: { 'Mox Amber': { price: '2.10', rarity: 'rare', inclusion: 18 } },
    optimizeSwaps: {
      additions: [],
      removals: [
        { name: 'Negate', reason: 'Low inclusion', reasonCategory: 'low-inclusion', inclusion: 3 },
        {
          name: 'Aetherize',
          reason: 'Excess Removal',
          reasonCategory: 'excess:removal',
          inclusion: 12,
        },
      ],
    },
  } as unknown as CommanderDeckAnalysisResult;
}

describe('buildCoachView', () => {
  const base = {
    commander: card(COMMANDER),
    partner: null,
    ownedPool: [],
    ownedLands: [],
    fixingLands: [],
    substitutesReady: false,
  };

  it('ranks the feed, the Cuts chip and the hero the way the deck page does', () => {
    const cards = tatyova();
    const combos = combosFromEdhrec([HULLBREAKER], [COMMANDER, ...cards.map((c) => c.name)]);
    const view = buildCoachView({
      ...base,
      cards,
      analysis: analysis(),
      ownedNames: new Set(),
      combos,
      ownedOnly: false,
    });
    const feedNames = view.feed.map((r) => r.change.name);
    // Gap rows by play rate. The Hullbreaker loop makes mana and ends nothing,
    // so its missing piece is no combo row (E437). The deck's ramp is at its
    // target, so Burgeoning is no gap (T171 round 3).
    expect(feedNames.slice(0, 3)).toEqual(['Rhystic Study', 'Fact or Fiction']);
    expect(feedNames).not.toContain('Mox Amber');
    expect(feedNames).not.toContain('Burgeoning');
    // The Cuts chip reads weakest first: the least played here leads.
    expect(view.cuts.map((r) => r.change.name)).toEqual(['Negate', 'Aetherize']);
    // And the hero does not name it either.
    expect(view.nbm.find((m) => m.cardName)?.cardName).not.toBe('Mox Amber');
    expect(view.roleCounts.cardDraw).toBeGreaterThan(0);
    expect(view.suggestions.staples.map((s) => s.name)).toEqual([
      'Rhystic Study',
      'Fact or Fiction',
      'Burgeoning',
    ]);
  });

  it('shows only owned rows under Owned only', () => {
    const view = buildCoachView({
      ...base,
      cards: tatyova(),
      analysis: analysis(),
      ownedNames: new Set(['Fact or Fiction']),
      combos: { inDeck: [], oneAway: [] },
      ownedOnly: true,
    });
    expect(view.feed.map((r) => r.change.name)).toEqual(['Fact or Fiction']);
  });

  // T171 round 3, v4 gate: a Yuriko deck with no budget had Underground Sea
  // swapped for Temple of Deceit by the Budget lane, with no reason given.
  it('runs the Budget lane only for a deck that asks to save money', () => {
    const withPlan = {
      ...analysis(),
      costPlan: {
        currentTotal: 50,
        minTotal: 45,
        spellRows: [
          {
            id: 'Counterspell',
            currentName: 'Counterspell',
            currentPrice: 1.5,
            // Below the least-played missing staple (22%): a drop-in, not a re-add.
            currentInclusion: 10,
            suggestionName: 'Mana Leak',
            suggestionPrice: 0.3,
            suggestionInclusion: 25,
            savings: 1.2,
            confidence: 'drop-in' as const,
            category: 'spell' as const,
          },
        ],
        landRows: [],
        protectedCount: 0,
      },
    } as unknown as CommanderDeckAnalysisResult;
    const view = (savesMoney: boolean) =>
      buildCoachView({
        ...base,
        cards: tatyova(),
        analysis: withPlan,
        ownedNames: new Set(),
        combos: { inDeck: [], oneAway: [] },
        ownedOnly: false,
        savesMoney,
      }).feed.filter((r) => r.change.lane === 'budget');
    expect(view(false)).toEqual([]);
    const rows = view(true);
    expect(rows.map((r) => r.change.name)).toEqual(['Mana Leak']);
    expect(rows[0].change.reason).toBe('Same job for less');
  });
});
