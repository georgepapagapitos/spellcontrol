import { describe, it, expect } from 'vitest';
import { analyzeDeck, computeOptimizeSwaps } from './deckAnalyzer';
import { buildCardInclusionMap, buildCardSynergyMap } from './commanderDeckAnalysis';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';

// Cards under test (no tagger data loaded in unit env → getCardRole returns
// null, so these are treated as roleless general-cut candidates unless we set
// deckRole). Inclusion/synergy come from the EDHREC fixture below.
const STAPLE = 'Staple Payoff'; // 40% inclusion — a near-staple, must NOT be cut
const FRINGE = 'Fringe Jank'; // 3% inclusion, no synergy — genuinely cuttable
const NARROW = 'Narrow Payoff'; // 12% inclusion but high synergy — must NOT be cut

function edhrec(): EDHRECCommanderData {
  const card = (name: string, inclusion: number, synergy = 0) => ({
    name,
    sanitized: name,
    primary_type: 'Creature',
    inclusion,
    synergy,
    num_decks: 0,
  });
  return {
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
      allNonLand: [card(STAPLE, 40, 0), card(FRINGE, 3, 0), card(NARROW, 12, 0.6)],
    },
    similarCommanders: [],
  };
}

const spell = (name: string): ScryfallCard =>
  ({
    name,
    cmc: 3,
    type_line: 'Creature',
    prices: {},
    color_identity: [],
    keywords: [],
  }) as unknown as ScryfallCard;
const forest = (): ScryfallCard =>
  ({
    name: 'Forest',
    cmc: 0,
    type_line: 'Basic Land — Forest',
    prices: {},
    color_identity: ['G'],
    keywords: [],
  }) as unknown as ScryfallCard;

function runOptimize(withSynergyGuard: boolean) {
  const spells = [spell(STAPLE), spell(FRINGE), spell(NARROW)];
  const lands = Array.from({ length: 36 }, forest);
  const cards = [...spells, ...lands];
  const names = cards.map((c) => c.name);
  const data = edhrec();
  const inclusionMap = buildCardInclusionMap(data, names);
  const synergyMap = buildCardSynergyMap(data, names);
  // Generous role targets so nothing reads as "excess role" — isolates the
  // general (inclusion/synergy) cut path under test.
  const roleTargets = { ramp: 10, removal: 10, boardwipe: 3, cardDraw: 10 };
  const roleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  const analysis = analyzeDeck(data, cards, roleCounts, roleTargets, 99, inclusionMap);
  const swaps = computeOptimizeSwaps(
    analysis,
    cards,
    inclusionMap,
    'Some Commander',
    undefined,
    new Set<string>(),
    new Set<string>(),
    undefined,
    withSynergyGuard ? synergyMap : undefined
  );
  return new Set(swaps.removals.map((r) => r.name));
}

describe('computeOptimizeSwaps — Commander cut calibration', () => {
  it('does not cut a 40%-inclusion near-staple as "low inclusion"', () => {
    const cut = runOptimize(true);
    expect(cut.has(STAPLE)).toBe(false);
  });

  it('still cuts a genuinely fringe (<8%) roleless card', () => {
    const cut = runOptimize(true);
    expect(cut.has(FRINGE)).toBe(true);
  });

  it('protects a low-inclusion but high-synergy payoff via the synergy guard', () => {
    const guarded = runOptimize(true);
    expect(guarded.has(NARROW)).toBe(false);
    // Without the synergy map, the same 12%-inclusion card is cut — proving the
    // guard (not the inclusion floor) is what spares it.
    const unguarded = runOptimize(false);
    expect(unguarded.has(NARROW)).toBe(true);
  });
});
