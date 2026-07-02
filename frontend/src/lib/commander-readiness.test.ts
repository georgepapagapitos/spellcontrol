import { describe, it, expect } from 'vitest';
import {
  extractCommanderCandidates,
  computeReadiness,
  sortCommanderCandidates,
  READINESS_POOL_SIZE,
  MAX_OWNED_SAMPLES,
  type ReadinessStaple,
  type ReadinessScore,
} from './commander-readiness';
import type { EnrichedCard } from '../types';

/** Build an EnrichedCard with sane defaults; override only what a test cares about. */
function card(p: Partial<EnrichedCard> & { name: string }): EnrichedCard {
  return {
    copyId: `copy_${p.name}`,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'mythic',
    scryfallId: `sf_${p.name}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    ...p,
  };
}

/** A commander-eligible card: legendary creature, commander-legal. */
function commander(name: string, extra: Partial<EnrichedCard> = {}): EnrichedCard {
  return card({
    name,
    typeLine: 'Legendary Creature — Human Wizard',
    legalities: { commander: 'legal' },
    ...extra,
  });
}

function staples(...entries: Array<[string, number]>): ReadinessStaple[] {
  return entries.map(([name, inclusion]) => ({ name, inclusion }));
}

describe('extractCommanderCandidates', () => {
  it('keeps only commander-eligible cards', () => {
    const cards = [
      commander('Atraxa, Praetors’ Voice'),
      card({ name: 'Sol Ring', typeLine: 'Artifact', legalities: { commander: 'legal' } }),
      card({
        name: 'Llanowar Elves',
        typeLine: 'Creature — Elf Druid',
        legalities: { commander: 'legal' },
      }),
    ];
    const result = extractCommanderCandidates(cards);
    expect(result.map((c) => c.name)).toEqual(['Atraxa, Praetors’ Voice']);
  });

  it('excludes a legendary creature that is banned in commander', () => {
    const banned = commander('Golos, Tireless Pilgrim', {
      legalities: { commander: 'banned' },
    });
    expect(extractCommanderCandidates([banned])).toEqual([]);
  });

  it('includes a non-creature whose text says it can be your commander', () => {
    const planeswalkerCommander = card({
      name: 'Commodore Guff',
      typeLine: 'Legendary Planeswalker — Guff',
      oracleText: 'commodore guff can be your commander.',
      legalities: { commander: 'legal' },
    });
    expect(extractCommanderCandidates([planeswalkerCommander]).map((c) => c.name)).toEqual([
      'Commodore Guff',
    ]);
  });

  it('dedupes by name, keeping the most recently imported copy (by addedAt, not id order)', () => {
    // Random-UUID ids whose lexical order is the OPPOSITE of import order: the
    // fix must key recency off addedAt, so the later-added 'new' wins regardless.
    const older = commander('Krenko, Mob Boss', { copyId: 'old', importId: 'zzz-old' });
    const newer = commander('Krenko, Mob Boss', { copyId: 'new', importId: 'aaa-new' });
    const recency = new Map([
      ['zzz-old', 100],
      ['aaa-new', 900],
    ]);
    const result = extractCommanderCandidates([older, newer], recency);
    expect(result).toHaveLength(1);
    expect(result[0].copyId).toBe('new');
  });

  it('treats an importId absent from the recency map as the oldest copy', () => {
    const noImport = commander('Krenko, Mob Boss', { copyId: 'noimp' });
    const withImport = commander('Krenko, Mob Boss', { copyId: 'imp', importId: 'imp_1' });
    const result = extractCommanderCandidates([noImport, withImport], new Map([['imp_1', 1]]));
    expect(result[0].copyId).toBe('imp');
  });

  it('returns an empty array for an empty collection', () => {
    expect(extractCommanderCandidates([])).toEqual([]);
  });
});

describe('computeReadiness', () => {
  const owned = new Set(['sol ring', 'arcane signet', 'cultivate']);

  it('counts owned staples and computes an integer percent', () => {
    const pool = staples(
      ['Sol Ring', 99],
      ['Arcane Signet', 95],
      ['Counterspell', 80],
      ['Cultivate', 60]
    );
    const score = computeReadiness(pool, owned, 'Atraxa, Praetors’ Voice');
    expect(score.available).toBe(true);
    expect(score.ownedCount).toBe(3);
    expect(score.totalCount).toBe(4);
    expect(score.percent).toBe(75);
  });

  it('matches names case-insensitively', () => {
    const score = computeReadiness(staples(['SOL RING', 99]), new Set(['sol ring']), 'Test');
    expect(score.ownedCount).toBe(1);
  });

  it('caps owned samples at MAX_OWNED_SAMPLES, in inclusion (list) order', () => {
    const allOwned = new Set(['a', 'b', 'c', 'd']);
    const pool = staples(['A', 99], ['B', 98], ['C', 97], ['D', 96]);
    const score = computeReadiness(pool, allOwned, 'Test');
    expect(score.ownedSamples).toHaveLength(MAX_OWNED_SAMPLES);
    expect(score.ownedSamples).toEqual(['A', 'B', 'C']);
  });

  it('returns 0% when no staples are owned', () => {
    const score = computeReadiness(staples(['Sol Ring', 99]), new Set(['island']), 'Test');
    expect(score.percent).toBe(0);
    expect(score.ownedCount).toBe(0);
    expect(score.ownedSamples).toEqual([]);
  });

  it('marks readiness unavailable when the staple list is empty (offline EDHREC)', () => {
    const score = computeReadiness([], owned, 'Atraxa, Praetors’ Voice');
    expect(score.available).toBe(false);
    expect(score.percent).toBe(0);
    expect(score.explainerLine).toMatch(/unavailable/i);
  });

  it('measures against at most READINESS_POOL_SIZE staples', () => {
    const big: ReadinessStaple[] = Array.from({ length: READINESS_POOL_SIZE + 50 }, (_, i) => ({
      name: `Card ${i}`,
      inclusion: 100 - i,
    }));
    // own every card, including ones beyond the pool
    const ownAll = new Set(big.map((s) => s.name.toLowerCase()));
    const score = computeReadiness(big, ownAll, 'Test');
    expect(score.totalCount).toBe(READINESS_POOL_SIZE);
    expect(score.ownedCount).toBe(READINESS_POOL_SIZE);
    expect(score.percent).toBe(100);
  });

  it('uses the short commander name in the explainer line', () => {
    const score = computeReadiness(staples(['Sol Ring', 99]), owned, 'Atraxa, Praetors’ Voice');
    expect(score.explainerLine).toBe("You own 1 of Atraxa's top 1 staples");
  });
});

describe('sortCommanderCandidates', () => {
  const atraxa = commander('Atraxa', { importId: 'imp_c' });
  const krenko = commander('Krenko', { importId: 'imp_a' });
  const yuriko = commander('Yuriko', { importId: 'imp_b' });
  const candidates = [krenko, atraxa, yuriko];
  // addedAt order (newest → oldest): atraxa, yuriko, krenko — independent of id order.
  const recency = new Map([
    ['imp_c', 300],
    ['imp_b', 200],
    ['imp_a', 100],
  ]);

  function score(percent: number, available = true): ReadinessScore {
    return {
      available,
      ownedCount: percent,
      totalCount: 100,
      percent,
      explainerLine: '',
      ownedSamples: [],
    };
  }

  it('sorts by name A→Z', () => {
    const result = sortCommanderCandidates(candidates, new Map(), 'name');
    expect(result.map((c) => c.name)).toEqual(['Atraxa', 'Krenko', 'Yuriko']);
  });

  it('sorts by most recently added (addedAt desc), missing recency last', () => {
    const noImport = commander('Zedruu');
    const result = sortCommanderCandidates(
      [...candidates, noImport],
      new Map(),
      'recentlyAdded',
      recency
    );
    expect(result.map((c) => c.name)).toEqual(['Atraxa', 'Yuriko', 'Krenko', 'Zedruu']);
  });

  it('sorts by readiness desc, sinking unscored and unavailable to the end', () => {
    const scores = new Map<string, ReadinessScore>([
      ['Krenko', score(80)],
      ['Atraxa', score(20)],
      ['Yuriko', score(0, false)], // unavailable
    ]);
    // Zedruu has no score entry at all
    const zedruu = commander('Zedruu');
    const result = sortCommanderCandidates([...candidates, zedruu], scores, 'readiness');
    expect(result.map((c) => c.name)).toEqual(['Krenko', 'Atraxa', 'Yuriko', 'Zedruu']);
  });

  it('breaks readiness ties by name for stable ordering while scores stream in', () => {
    const scores = new Map<string, ReadinessScore>([
      ['Atraxa', score(50)],
      ['Krenko', score(50)],
      ['Yuriko', score(50)],
    ]);
    const result = sortCommanderCandidates(candidates, scores, 'readiness');
    expect(result.map((c) => c.name)).toEqual(['Atraxa', 'Krenko', 'Yuriko']);
  });

  it('does not mutate the input array', () => {
    const input = [...candidates];
    sortCommanderCandidates(input, new Map(), 'name');
    expect(input).toEqual(candidates);
  });
});
