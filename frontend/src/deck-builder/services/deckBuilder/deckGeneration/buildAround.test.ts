import { describe, expect, it } from 'vitest';
import type {
  BuildAroundRow,
  Customization,
  EDHRECCard,
  LiftEntry,
  ScryfallCard,
} from '@/deck-builder/types';
import { buildAroundLine } from '@/components/deck/BuildReportPanel';
import {
  ADMIT_OVERFETCH,
  MAX_BUILD_AROUND,
  MAX_SEED_ADMITS,
  SEED_ADMIT_MAX_INCLUSION,
  asMustIncludes,
  buildAroundNames,
  seatSeedAdmits,
  seedLift,
  seedAdmitPoolCard,
  seedPoolsOf,
  selectSeedAdmits,
  summarizeBuildAround,
} from './buildAround';
import { STAPLE_INCLUSION_BAR } from '../roleCapAllowance';

const entry = (name: string, over: Partial<LiftEntry> = {}): LiftEntry => ({
  name,
  lift: 4,
  coPlayPct: 30,
  numDecks: 400,
  potentialDecks: 1200,
  lowSample: false,
  ...over,
});

describe('buildAroundNames', () => {
  it('trims, drops blanks and case-insensitive repeats, and caps the list', () => {
    expect(buildAroundNames(undefined)).toEqual([]);
    expect(
      buildAroundNames([' Pitiless Plunderer ', '', 'pitiless plunderer', 'Mayhem Devil'])
    ).toEqual(['Pitiless Plunderer', 'Mayhem Devil']);
    const many = Array.from({ length: 30 }, (_, i) => `Card ${i}`);
    expect(buildAroundNames(many)).toHaveLength(MAX_BUILD_AROUND);
  });
});

describe('seedPoolsOf', () => {
  it("keeps only the player's seeds, whatever their casing", () => {
    const pools = new Map([
      ['Krenko, Mob Boss', [entry('Goblin Chieftain')]],
      ['Pitiless Plunderer', [entry('Mayhem Devil')]],
    ]);
    expect([...seedPoolsOf(pools, ['pitiless plunderer']).keys()]).toEqual(['Pitiless Plunderer']);
    expect(seedPoolsOf(pools, []).size).toBe(0);
  });
});

describe('selectSeedAdmits', () => {
  const pools = new Map([
    [
      'Pitiless Plunderer',
      [
        entry('Mayhem Devil', { coPlayPct: 55, lift: 6 }),
        entry('Viscera Seer', { coPlayPct: 20 }),
        entry('Thin Sample', { numDecks: 12, lowSample: true }),
        entry('Sol Ring', { coPlayPct: 80, lift: 1 }),
      ],
    ],
    ['Grim Hireling', [entry('Mayhem Devil', { coPlayPct: 25 }), entry('Goldspan Dragon')]],
  ]);

  it('is empty with no seed pools', () => {
    expect(selectSeedAdmits(new Map(), {})).toEqual([]);
  });

  it('skips cards already in the pool, drops thin samples, and ranks clusters first', () => {
    const admits = selectSeedAdmits(pools, { artifact: [{ name: 'Sol Ring' } as EDHRECCard] });
    const names = admits.map((a) => a.name);
    expect(names).not.toContain('Sol Ring');
    expect(names).not.toContain('Thin Sample');
    expect(names[0]).toBe('Mayhem Devil');
    expect(admits[0].seeds).toEqual(['Pitiless Plunderer', 'Grim Hireling']);
  });

  it('holds every admitted card under the staple bar', () => {
    const admits = selectSeedAdmits(pools, {}, [new Set<string>()]);
    expect(SEED_ADMIT_MAX_INCLUSION).toBeLessThan(STAPLE_INCLUSION_BAR);
    // Half the co-play share: 55% in the seed's decks stands at 28 here.
    expect(admits.find((a) => a.name === 'Mayhem Devil')!.inclusion).toBe(28);
    expect(admits.find((a) => a.name === 'Viscera Seer')!.inclusion).toBe(10);
    const sure = new Map([['Seed', [entry('Always Played', { coPlayPct: 100 })]]]);
    expect(selectSeedAdmits(sure, {})[0].inclusion).toBe(SEED_ADMIT_MAX_INCLUSION);
    for (const a of admits) expect(a.inclusion).toBeLessThan(STAPLE_INCLUSION_BAR);
  });

  it('caps how many cards the seeds can add', () => {
    const big = new Map([
      ['Seed', Array.from({ length: 200 }, (_, i) => entry(`Card ${i}`, { lift: 2 + i }))],
    ]);
    // Three candidates per slot: the cut to the cap comes after the filters.
    expect(selectSeedAdmits(big, {})).toHaveLength(MAX_SEED_ADMITS * ADMIT_OVERFETCH);
  });
});

describe('seedAdmitPoolCard', () => {
  it('is a plain typed pool row: not a theme card, not a staple', () => {
    const row = seedAdmitPoolCard({ name: 'Mayhem Devil', inclusion: 39, seeds: [] }, 'Creature');
    expect(row).toMatchObject({
      name: 'Mayhem Devil',
      primary_type: 'Creature',
      inclusion: 39,
      synergy: 0,
      isThemeSynergyCard: false,
    });
  });
});

describe('summarizeBuildAround', () => {
  const seedPools = new Map([
    [
      'Pitiless Plunderer',
      [
        entry('Mayhem Devil', { coPlayPct: 55 }),
        entry('Sol Ring'),
        entry('Viscera Seer'),
        entry('Bonecrusher Giant', { coPlayPct: 20 }),
      ],
    ],
  ]);
  const credited = new Set(['Mayhem Devil', 'Viscera Seer', 'Bonecrusher Giant']);

  it('credits a seed only with cards that are in the deck because of it', () => {
    const rows = summarizeBuildAround({
      seeds: ['Pitiless Plunderer'],
      seedPools,
      credited,
      deckNames: ['Pitiless Plunderer', 'Mayhem Devil', 'Sol Ring'],
    });
    expect(rows).toEqual([{ seed: 'Pitiless Plunderer', broughtIn: ['Mayhem Devil'] }]);
  });

  it('finds a card the deck holds under its two-faced name', () => {
    const [row] = summarizeBuildAround({
      seeds: ['Pitiless Plunderer'],
      seedPools,
      credited,
      deckNames: ['Pitiless Plunderer', 'Bonecrusher Giant // Stomp'],
    });
    expect(row.broughtIn).toEqual(['Bonecrusher Giant']);
  });

  it('tells a skipped seed, a seed with no data and a build with no EDHREC apart', () => {
    const base = { seedPools, credited, deckNames: ['Obscure Card', 'Mayhem Devil'] };
    expect(summarizeBuildAround({ ...base, seeds: ['Pitiless Plunderer'] })).toEqual([
      { seed: 'Pitiless Plunderer', broughtIn: [], notSeated: true },
    ]);
    expect(summarizeBuildAround({ ...base, seeds: ['Obscure Card'] })).toEqual([
      { seed: 'Obscure Card', broughtIn: [], noData: true },
    ]);
    expect(summarizeBuildAround({ ...base, seeds: ['Obscure Card'], noEdhrec: true })).toEqual([
      { seed: 'Obscure Card', broughtIn: [], noEdhrec: true },
    ]);
  });
});

describe('asMustIncludes', () => {
  const base = { mustIncludeCards: ['Sol Ring', 'mayhem devil'] } as Customization;

  it('is the same object when no card is named, so a plain build is untouched', () => {
    expect(asMustIncludes(base)).toBe(base);
    expect(asMustIncludes({ ...base, buildAroundCards: [] })).toEqual({
      ...base,
      buildAroundCards: [],
    });
  });

  it('puts the build-around cards first and drops a repeat', () => {
    const out = asMustIncludes({ ...base, buildAroundCards: ['Mayhem Devil', 'Viscera Seer'] });
    expect(out.mustIncludeCards).toEqual(['Mayhem Devil', 'Viscera Seer', 'Sol Ring']);
  });
});

describe('seating and seeds', () => {
  const sc = (name: string, type_line = 'Creature') => ({ name, type_line }) as ScryfallCard;
  const lift = (held: string[], seeds: string[]) =>
    seedLift({
      liftSeedPools: new Map([['Pitiless Plunderer', [entry('Mayhem Devil')]]]),
      cfg: { buildAround: seeds },
      seedAdmitInclusion: new Map(),
      categories: { synergy: held.map((n) => sc(n)) },
    } as unknown as Parameters<typeof seedLift>[0]);

  it('a seed that was not seated steers nothing', () => {
    expect(lift(['Pitiless Plunderer'], ['Pitiless Plunderer']).pools.size).toBe(1);
    expect(lift([], ['Pitiless Plunderer']).pools.size).toBe(0);
    expect(lift(['Pitiless Plunderer'], []).pools.size).toBe(0);
  });

  // The Krenko case: the strongest co-plays of a seed are mostly another color.
  it('cuts to the cap after the filter, so off-color cards do not use up the slots', () => {
    const pool = [
      ...Array.from({ length: MAX_SEED_ADMITS }, (_, i) =>
        entry(`Off ${i}`, { lift: 50, coPlayPct: 60 })
      ),
      entry('On Color', { lift: 3, coPlayPct: 30 }),
    ];
    const seeds = lift(['Seed'], []);
    const admits = selectSeedAdmits(new Map([['Seed', pool]]), {});
    expect(admits.map((a) => a.name)).toContain('On Color');
    const cardMap = new Map(admits.map((a) => [a.name, sc(a.name)]));
    const typePools: Record<string, EDHRECCard[]> = { creature: [] };
    const why = new Map<string, string>();
    seatSeedAdmits(admits, cardMap, typePools, seeds, why, (c) => c.name === 'On Color');
    expect(typePools.creature.map((c) => c.name)).toEqual(['On Color']);
    expect(seeds.admitted.get('On Color')).toBe(15);
    expect(why.get('On Color')).toBe('Plays with Seed');
  });

  it('never seats more than the cap, and never a land', () => {
    const pool = Array.from({ length: MAX_SEED_ADMITS * 3 }, (_, i) => entry(`Card ${i}`));
    const admits = selectSeedAdmits(new Map([['Seed', pool]]), {});
    const cardMap = new Map(admits.map((a) => [a.name, sc(a.name)]));
    cardMap.set('Card 0', sc('Card 0', 'Land'));
    const typePools: Record<string, EDHRECCard[]> = { creature: [] };
    seatSeedAdmits(admits, cardMap, typePools, lift(['Seed'], []), new Map(), () => true);
    expect(typePools.creature).toHaveLength(MAX_SEED_ADMITS);
    expect(typePools.creature.map((c) => c.name)).not.toContain('Card 0');
  });

  it('leaves out a card another rule already put in the pool or ruled out', () => {
    const pools = new Map([['Seed', [entry('Combo Piece'), entry('Fresh')]]]);
    const names = selectSeedAdmits(pools, {}, [new Set(['Combo Piece'])]).map((a) => a.name);
    expect(names).toEqual(['Fresh']);
  });
});

describe('buildAroundLine', () => {
  it('says what a seed did, in each of its states', () => {
    const row = (over: Partial<BuildAroundRow>): BuildAroundRow => ({
      seed: 'Seed',
      broughtIn: [],
      ...over,
    });
    expect(buildAroundLine(row({ broughtIn: ['A', 'B'] }))).toBe('Brought in A, B.');
    expect(buildAroundLine(row({ broughtIn: ['A', 'B', 'C', 'D', 'E', 'F'] }))).toBe(
      'Brought in A, B, C, D, and 2 more.'
    );
    expect(buildAroundLine(row({}))).toContain("didn't beat this commander's own picks");
    expect(buildAroundLine(row({ noData: true }))).toContain('Too few decks');
    expect(buildAroundLine(row({ noEdhrec: true }))).toContain('no EDHREC data');
    expect(buildAroundLine(row({ notSeated: true }))).toContain('Not in the deck');
  });
});
