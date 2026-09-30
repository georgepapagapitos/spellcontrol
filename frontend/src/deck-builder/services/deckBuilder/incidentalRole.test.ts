// Guard (T171 round 3): the excess-role cutter took Isshin's own plan cards.
// Battle Angels of Tyr went as "Excess Ramp" (tagged ramp for its Treasure),
// Drakuseth, Maw of Flames as "Excess Removal" and Laelia, the Blade Reforged
// as "Excess Card advantage": all three are attack-trigger payoffs Isshin
// doubles, and the deck's Signets stayed. Real cards (Scryfall 2026-09-29).
import { describe, it, expect, afterEach } from 'vitest';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import { COACH_CARDS, coachCardFactsSnapshot } from './__fixtures__/coach-cards.fixtures';
import { buildCommanderProfile } from './commanderProfile';
import { roleIsIncidental } from './incidentalRole';
import { analyzeDeck, computeOptimizeSwaps } from './deckAnalyzer';
import { buildCardInclusionMap } from './commanderDeckAnalysis';

const real = (name: string, deckRole?: string): ScryfallCard =>
  ({ ...COACH_CARDS[name], ...(deckRole ? { deckRole } : {}) }) as ScryfallCard;
const isshin = buildCommanderProfile(real('Isshin, Two Heavens as One'));
const lathril = buildCommanderProfile(real('Lathril, Blade of the Elves'));

afterEach(() => setCardFactsSnapshot(null));

describe('roleIsIncidental', () => {
  it("reads a card that feeds the commander's own ability as a plan card", () => {
    expect(roleIsIncidental(real('Battle Angels of Tyr'), 'ramp', isshin)).toBe(true);
    expect(roleIsIncidental(real('Drakuseth, Maw of Flames'), 'removal', isshin)).toBe(true);
    expect(roleIsIncidental(real('Laelia, the Blade Reforged'), 'cardDraw', isshin)).toBe(true);
    expect(roleIsIncidental(real('Llanowar Elves'), 'ramp', lathril)).toBe(true);
  });

  it('keeps a card whose role is what it is', () => {
    for (const rock of ['Boros Signet', 'Rakdos Signet', 'Talisman of Conviction'])
      expect(roleIsIncidental(real(rock), 'ramp', isshin)).toBe(false);
    expect(roleIsIncidental(real('Coldsteel Heart'), 'ramp', lathril)).toBe(false);
  });

  it('reads the card facts when the role ranks below another primary role', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    // Battle Angels draws first; its Treasure is the second job.
    expect(roleIsIncidental(real('Battle Angels of Tyr'), 'ramp', null)).toBe(true);
    expect(roleIsIncidental(real('Boros Signet'), 'ramp', null)).toBe(false);
  });
});

describe('computeOptimizeSwaps — excess-role cuts', () => {
  const PAGE: [string, number][] = [
    ['Battle Angels of Tyr', 3],
    ['Rakdos Signet', 28],
    ['Orzhov Signet', 29],
    ['Talisman of Conviction', 45],
    ['Boros Signet', 34],
    ['Arcane Signet', 87],
  ];
  const edhrec = {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 1000,
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
      landDistribution: { basic: 35, nonbasic: 2, total: 37 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: PAGE.map(([name, inclusion]) => ({
        name,
        sanitized: name,
        primary_type: 'Artifact',
        inclusion,
        synergy: 0,
        num_decks: 0,
      })),
    },
    similarCommanders: [],
  } as unknown as EDHRECCommanderData;

  const excessRampCuts = (withGuard: boolean) => {
    const cards = PAGE.map(([name]) => real(name, 'ramp'));
    const inclusionMap = buildCardInclusionMap(
      edhrec,
      cards.map((c) => c.name)
    );
    // Ramp 6 of 2: the cutter trims up to three.
    const analysis = analyzeDeck(edhrec, cards, { ramp: 6 }, { ramp: 2 }, 99, inclusionMap);
    return computeOptimizeSwaps(
      analysis,
      cards,
      inclusionMap,
      'Isshin, Two Heavens as One',
      undefined,
      new Set(),
      new Set(),
      undefined,
      undefined,
      undefined,
      undefined,
      withGuard ? (card, role) => roleIsIncidental(card, role, isshin) : undefined
    )
      .removals.filter((r) => r.reason === 'Excess Ramp')
      .map((r) => r.name);
  };

  it('never cuts a plan card as excess; the weakest rocks go instead', () => {
    // Unguarded, the least-played ramp card is Battle Angels of Tyr.
    expect(excessRampCuts(false)).toContain('Battle Angels of Tyr');
    expect(excessRampCuts(true)).toEqual(['Rakdos Signet', 'Orzhov Signet', 'Boros Signet']);
  });
});
