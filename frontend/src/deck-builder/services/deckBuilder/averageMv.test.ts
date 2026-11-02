// Guard (E1078): one average mana value, one cutoff, on every screen.
// Before, the Mana tile averaged raw MV, the curve verdict averaged MV rounded
// and capped at 7, the summary averaged the capped slot counts, and the
// checklist warned at 3.5 while the verdict called anything under 3.8
// comfortable. A deck of cmc-10 cards read 10, 7 and 7 on three screens.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import { Archetype } from '@/deck-builder/types';
import { buildManaData } from '@/lib/deck-analysis/build-mana-data';
import { analyzeDeck as analyzeDeckView } from '@/lib/deck-analysis/deck-analysis';
import { averageNonlandMv, TOP_HEAVY_AVG_MV } from '@/lib/deck-analysis/average-mana-value';
import { analyzeDeck, getDeckSummaryData } from './deckAnalyzer';
import { computeAutoLandCount } from './targetCounts';
import { buildValidationChecklist } from './validationChecklist';

const spell = (cmc: number, i = 0): ScryfallCard =>
  ({
    id: `s${i}`,
    oracle_id: `o${i}`,
    name: `Spell ${cmc}-${i}`,
    cmc,
    type_line: 'Sorcery',
    color_identity: [],
    colors: [],
    legalities: { commander: 'legal' },
  }) as unknown as ScryfallCard;

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
    allNonLand: [],
  },
  similarCommanders: [],
} as unknown as EDHRECCommanderData;

describe('average mana value agrees on every screen', () => {
  const cards = Array.from({ length: 40 }, (_, i) => spell(10, i));

  it('a cmc-10 deck reads 10 on the tile, the curve verdict and the summary', () => {
    const tile = buildManaData(cards, null).averageCmc;
    const curve = analyzeDeckView(
      {
        format: 'commander',
        commander: null,
        partnerCommander: null,
        mainboard: cards.map((card, i) => ({ slotId: `s${i}`, card })),
      },
      false
    ).curve;
    const analysis = analyzeDeck(edhrec, cards, {}, {}, 100);
    expect(tile).toBe(10);
    expect(curve.averageCmc).toBe(10);
    // The AI prompt keeps the capped, rounded average it always got.
    expect(curve.promptAverageCmc).toBe(7);
    expect(analysis.averageMv).toBe(10);
    expect(curve.verdict).toBe('top-heavy');
    const summary = getDeckSummaryData(analysis);
    expect(summary.notes.find((n) => n.label === 'Curve')?.text).toContain(
      'avg mana value is 10.0'
    );
  });
});

describe('checklist Curve agrees with the analysis verdict at the 3.8 cutoff', () => {
  const deck = () => [
    { name: 'Niv-Mizzet, Parun', color_identity: ['U', 'R'], type_line: 'Legendary Creature' },
  ];
  it.each([
    [3.5, 'pass'],
    [3.6, 'pass'],
    [3.79, 'pass'],
    [3.8, 'warn'],
    [3.81, 'warn'],
  ])('avg %s is %s, matching the verdict', (avg, status) => {
    const check = buildValidationChecklist({ cards: deck(), averageCmc: avg }).checks.find(
      (c) => c.id === 'curve'
    );
    expect(check?.status).toBe(status);
    // The verdict reads the same average against the same constant.
    const cards = [{ ...spell(0, 0), cmc: avg }];
    const verdict = analyzeDeckView(
      {
        format: 'commander',
        commander: null,
        partnerCommander: null,
        mainboard: [{ slotId: 'a', card: cards[0] }],
      },
      false
    ).curve.verdict;
    expect(verdict === 'top-heavy').toBe(status === 'warn');
    expect(TOP_HEAVY_AVG_MV).toBe(3.8);
  });
});

describe('averageNonlandMv', () => {
  it('is uncapped, unrounded and skips missing values', () => {
    expect(averageNonlandMv([{ cmc: 10 }, { cmc: 0.5 }, { cmc: NaN }, {}])).toBe(5.25);
    expect(averageNonlandMv([])).toBe(0);
  });
});

describe('deck generation keeps its own average (E1078 hard constraint)', () => {
  // buildPlan sizes lands from the EDHREC curve average. Pin the value on a
  // fixture curve so a change to its inputs or to the formula shows here.
  const manaCurve: Record<number, number> = { 1: 10, 2: 20, 3: 25, 4: 15, 5: 10, 6: 5, 7: 3 };
  it('pins computeAutoLandCount on a fixture curve', () => {
    const total = Object.values(manaCurve).reduce((s, v) => s + v, 0);
    const avg = Object.entries(manaCurve).reduce((s, [c, n]) => s + Number(c) * n, 0) / total;
    expect(avg).toBe(3.25);
    expect(computeAutoLandCount(Archetype.GOODSTUFF, 10, avg)).toBe(39);
  });
  it('generation code does not read the shared leaf', () => {
    const root = join(__dirname, '..', '..', '..');
    for (const f of [
      'deck-builder/services/deckBuilder/deckGeneration/buildPlan.ts',
      'deck-builder/services/deckBuilder/targetCounts.ts',
      'deck-builder/services/deckBuilder/landGenerator.ts',
    ]) {
      expect(readFileSync(join(root, f), 'utf8')).not.toContain('average-mana-value');
    }
  });
});
