import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EDHRECCard, LiftEntry, ScryfallCard } from '@/deck-builder/types';
import { buildLiftIndex } from './liftSynergy';
import {
  LIFT_BLEND_ENABLED,
  LIFT_BLEND_PATTERN,
  blendWithLift,
  interleaveLanes,
} from './liftBlend';
import { pickFromPrefetchedWithCurve } from './cardPicking';

const here = dirname(fileURLToPath(import.meta.url));

type LiftTuple = [name: string, lift: number, numDecks: number, potentialDecks: number];
interface Fixture {
  queries: { commander: string; context: string[]; positives: string[]; distractors: string[] }[];
  liftPools: Record<string, LiftTuple[]>;
}
// Real EDHREC card-page lift pools (the liftSynergy eval corpus), Krenko, Mob Boss query.
const fx: Fixture = JSON.parse(
  readFileSync(resolve(here, '__fixtures__', 'edhrec-lift.fixture.json'), 'utf8')
);
const query = fx.queries.find((q) => q.commander === 'Krenko, Mob Boss')!;
const seedPools = new Map<string, LiftEntry[]>(
  query.context.map((seed) => [
    seed,
    fx.liftPools[seed].map(([name, lift, numDecks, potentialDecks]) => ({
      name,
      lift,
      coPlayPct: Math.round((numDecks / potentialDecks) * 100),
      numDecks,
      potentialDecks,
      lowSample: numDecks < 50,
    })),
  ])
);
const liftIndex = buildLiftIndex(seedPools);
const liftScore = (name: string) => liftIndex.get(name.toLowerCase())?.clusterScore ?? 0;

// Lift-signalled cards (best first) and cards the six pools never mention.
const withSignal = [...new Set([...query.positives, ...query.distractors])]
  .filter((n) => liftScore(n) > 0)
  .sort((a, b) => liftScore(b) - liftScore(a));
const noSignal = [...new Set([...query.positives, ...query.distractors])]
  .filter((n) => liftScore(n) === 0)
  .sort();

describe('interleaveLanes', () => {
  it('walks the pattern and skips names already placed', () => {
    expect(
      interleaveLanes(
        [
          ['a', 'b', 'c', 'd'],
          ['x', 'a', 'y'],
        ],
        [0, 0, 1]
      )
    ).toEqual(['a', 'b', 'x', 'c', 'd', 'y']);
  });

  it('hands a spent lane its slots to the other lane', () => {
    expect(interleaveLanes([[], ['p', 'q']], [0, 1])).toEqual(['p', 'q']);
  });
});

describe('blendWithLift on real Krenko lift pools', () => {
  it('has real fixture signal to test with', () => {
    expect(withSignal.length).toBeGreaterThanOrEqual(3);
    expect(noSignal.length).toBeGreaterThanOrEqual(6);
  });

  // Popularity order puts every unsignalled card first, as a popularity list would.
  const popularity = [...noSignal, ...withSignal];

  it('gives lift one slot in three, best lift first', () => {
    const out = blendWithLift(popularity, liftScore, 0.5);
    expect([...out].sort()).toEqual([...popularity].sort());
    expect(out[2]).toBe(withSignal[0]);
    expect(out[5]).toBe(withSignal[1]);
    expect(out[8]).toBe(withSignal[2]);
    // the other slots keep the existing order
    expect([out[0], out[1], out[3], out[4]]).toEqual(noSignal.slice(0, 4));
  });

  it('is the identity when the switch is off, at pure Staples, or with no lift signal', () => {
    expect(blendWithLift(popularity, liftScore, 0.5, undefined, false)).toEqual(popularity);
    expect(blendWithLift(popularity, liftScore, 0)).toEqual(popularity);
    expect(blendWithLift(noSignal, liftScore, 0.5)).toEqual(noSignal);
  });

  it('keeps exempt cards in their place (they never join the lift lane)', () => {
    const exempt = new Set(withSignal.slice(0, 2));
    const out = blendWithLift(popularity, liftScore, 0.5, (n) => exempt.has(n));
    expect(out[2]).toBe(withSignal[2]);
    // never pulled forward: they stay behind the lane's picks, in their own order
    expect(out.indexOf(withSignal[0])).toBeGreaterThan(out.indexOf(withSignal[2]));
    expect(out.indexOf(withSignal[0])).toBeLessThan(out.indexOf(withSignal[1]));
  });

  it('ships on, with a 2:1 pattern', () => {
    expect(LIFT_BLEND_ENABLED).toBe(true);
    expect(LIFT_BLEND_PATTERN).toEqual([0, 0, 1]);
  });
});

describe('the picker with the blend', () => {
  const names = [...noSignal.slice(0, 6), ...withSignal.slice(0, 3)];
  // inclusion falls down the list, so the lift cards are the least popular
  const pool: EDHRECCard[] = names.map((name, i) => ({
    name,
    sanitized: name.toLowerCase(),
    primary_type: 'Creature',
    inclusion: 30 - i,
    num_decks: 1000,
  }));
  const cardMap = new Map<string, ScryfallCard>(
    names.map((name) => [
      name,
      {
        id: name,
        oracle_id: name,
        name,
        cmc: 2,
        type_line: 'Creature',
        color_identity: ['R'],
        legalities: { commander: 'legal' },
        prices: {},
        rarity: 'rare',
        keywords: [],
      } as unknown as ScryfallCard,
    ])
  );
  const liftTieBreak = new Map(names.map((n) => [n.toLowerCase(), liftScore(n)]));
  const pick = (count: number, tieBreak: Map<string, number>, brewLevel = 0.5) =>
    pickFromPrefetchedWithCurve(
      pool,
      cardMap,
      count,
      new Set<string>(),
      ['R'],
      { 0: 20, 1: 20, 2: 20 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      undefined,
      undefined,
      tieBreak,
      undefined,
      false,
      undefined,
      undefined,
      brewLevel
    ).map((c) => c.name);

  it('seats a lift card in the third slot that popularity alone would hand to a plain card', () => {
    const off = pick(3, new Map());
    const on = pick(3, liftTieBreak);
    expect(off).toEqual(noSignal.slice(0, 3));
    expect(on.slice(0, 2)).toEqual(noSignal.slice(0, 2));
    expect(on[2]).toBe(withSignal[0]);
  });

  it('does not touch the pick at pure Staples', () => {
    expect(pick(3, liftTieBreak, 0)).toEqual(noSignal.slice(0, 3));
  });
});
