import { describe, it, expect } from 'vitest';
import {
  LIFT_CONFIDENCE_K,
  edgeScore,
  aggregateLiftCandidates,
  selectTopLiftPicks,
  type LiftCandidate,
} from './liftSynergy';
import type { LiftEntry } from '@/deck-builder/types';

function entry(overrides: Partial<LiftEntry> & { name: string }): LiftEntry {
  return {
    lift: 1,
    coPlayPct: 10,
    numDecks: 100,
    potentialDecks: 1000,
    lowSample: false,
    ...overrides,
  };
}

describe('edgeScore', () => {
  it('is lift * coPlayPct, confidence-discounted by sample size', () => {
    expect(edgeScore({ lift: 2, coPlayPct: 10, numDecks: 50 })).toBeCloseTo(2 * 10 * (50 / 100));
  });

  it('approaches full weight as numDecks grows relative to the confidence constant', () => {
    expect(LIFT_CONFIDENCE_K).toBe(50);
    const small = edgeScore({ lift: 5, coPlayPct: 20, numDecks: 10 });
    const large = edgeScore({ lift: 5, coPlayPct: 20, numDecks: 10000 });
    expect(large).toBeGreaterThan(small);
    expect(large / (5 * 20)).toBeGreaterThan(0.99);
  });
});

describe('aggregateLiftCandidates', () => {
  it('builds one edge per seed that mentions a candidate', () => {
    const pools = new Map<string, LiftEntry[]>([
      ['Seed A', [entry({ name: 'Candidate' })]],
      ['Seed B', [entry({ name: 'Candidate' })]],
    ]);
    const [candidate] = aggregateLiftCandidates(pools);
    expect(candidate.connectionCount).toBe(2);
    expect(candidate.edges.map((e) => e.seed)).toEqual(['Seed A', 'Seed B']);
  });

  it('excludes named cards case-insensitively', () => {
    const pools = new Map<string, LiftEntry[]>([['Seed A', [entry({ name: 'sol ring' })]]]);
    const candidates = aggregateLiftCandidates(pools, { excludeNames: new Set(['Sol Ring']) });
    expect(candidates).toEqual([]);
  });

  it('skips a seed mentioning itself', () => {
    const pools = new Map<string, LiftEntry[]>([['Sol Ring', [entry({ name: 'Sol Ring' })]]]);
    expect(aggregateLiftCandidates(pools)).toEqual([]);
  });

  it('honors minConnections', () => {
    const pools = new Map<string, LiftEntry[]>([
      ['Seed A', [entry({ name: 'Solo' })]],
      ['Seed B', [entry({ name: 'Duo' })]],
      ['Seed C', [entry({ name: 'Duo' })]],
    ]);
    const candidates = aggregateLiftCandidates(pools, { minConnections: 2 });
    expect(candidates.map((c) => c.name)).toEqual(['Duo']);
  });

  it('sorts by connectionCount desc, then bestLift desc, then name asc', () => {
    const pools = new Map<string, LiftEntry[]>([
      ['Seed A', [entry({ name: 'Zeta', lift: 2 }), entry({ name: 'Beta', lift: 9 })]],
      ['Seed B', [entry({ name: 'Beta', lift: 3 })]],
      ['Seed C', [entry({ name: 'Alpha', lift: 9 })]],
    ]);
    const names = aggregateLiftCandidates(pools).map((c) => c.name);
    // Beta: 2 connections, bestLift 9. Zeta/Alpha: 1 connection each, bestLift 9/2 -> Zeta ties Alpha on lift? no.
    expect(names[0]).toBe('Beta'); // 2 connections beats everything with 1
    expect(names.slice(1)).toEqual(['Alpha', 'Zeta']); // both 1 connection, Alpha bestLift 9 > Zeta's 2
  });

  it('the proof: a candidate clustered across 3 seeds outranks a single high-lift low-sample fluke', () => {
    const cluster = entry({ name: 'Clustered Pick', lift: 6, coPlayPct: 15, numDecks: 400 });
    const fluke = entry({
      name: 'Lucky Fluke',
      lift: 40,
      coPlayPct: 1,
      numDecks: 15,
      lowSample: true,
    });
    const pools = new Map<string, LiftEntry[]>([
      ['Seed A', [cluster, fluke]],
      ['Seed B', [{ ...cluster }]],
      ['Seed C', [{ ...cluster }]],
    ]);
    const candidates = aggregateLiftCandidates(pools);
    const byName = new Map(candidates.map((c) => [c.name, c]));
    const clustered = byName.get('Clustered Pick')!;
    const flukeCand = byName.get('Lucky Fluke')!;
    expect(clustered.clusterScore).toBeGreaterThan(flukeCand.clusterScore);
    expect(clustered.bombScore).toBeGreaterThan(flukeCand.bombScore);

    const [firstPick] = selectTopLiftPicks(candidates);
    expect(firstPick.candidate.name).toBe('Clustered Pick');
  });
});

describe('selectTopLiftPicks', () => {
  function candidate(overrides: Partial<LiftCandidate> & { name: string }): LiftCandidate {
    return {
      edges: [{ seed: 'Seed', lift: overrides.bestLift ?? 1, coPlayPct: 10, numDecks: 100 }],
      connectionCount: 1,
      bestLift: 1,
      bombScore: 1,
      clusterScore: 1,
      lowSample: false,
      ...overrides,
    };
  }

  it('returns [] for empty input', () => {
    expect(selectTopLiftPicks([])).toEqual([]);
  });

  it('labels the highest-bombScore candidate clearing the lift floor as the bomb', () => {
    const bomb = candidate({ name: 'Bomb', bestLift: 10, bombScore: 50, connectionCount: 1 });
    const belowFloor = candidate({
      name: 'Too Weak',
      bestLift: 4,
      bombScore: 999,
      connectionCount: 1,
    });
    const picks = selectTopLiftPicks([bomb, belowFloor]);
    expect(picks[0]).toMatchObject({ kind: 'bomb', candidate: { name: 'Bomb' } });
  });

  it('ranks cluster picks by clusterScore desc, excluding the bomb by name', () => {
    const bomb = candidate({
      name: 'Bomb',
      bestLift: 10,
      bombScore: 50,
      connectionCount: 3,
      clusterScore: 999,
    });
    const clusterHigh = candidate({ name: 'Cluster High', connectionCount: 2, clusterScore: 20 });
    const clusterLow = candidate({ name: 'Cluster Low', connectionCount: 2, clusterScore: 5 });
    const picks = selectTopLiftPicks([bomb, clusterLow, clusterHigh]);
    expect(picks.map((p) => p.candidate.name)).toEqual(['Bomb', 'Cluster High', 'Cluster Low']);
    expect(picks.slice(1).every((p) => p.kind === 'cluster')).toBe(true);
  });

  it('excludes single-connection candidates from cluster picks', () => {
    const solo = candidate({ name: 'Solo', connectionCount: 1, bestLift: 1, clusterScore: 999 });
    expect(selectTopLiftPicks([solo])).toEqual([]);
  });

  it('caps to max and never duplicates the bomb', () => {
    const bomb = candidate({
      name: 'Bomb',
      bestLift: 10,
      bombScore: 50,
      connectionCount: 4,
      clusterScore: 40,
    });
    const clusters = ['C1', 'C2', 'C3', 'C4'].map((name, i) =>
      candidate({ name, connectionCount: 2, clusterScore: 10 - i })
    );
    const picks = selectTopLiftPicks([bomb, ...clusters], { max: 3 });
    expect(picks).toHaveLength(3);
    expect(picks.filter((p) => p.candidate.name === 'Bomb')).toHaveLength(1);
    expect(picks.map((p) => p.candidate.name)).toEqual(['Bomb', 'C1', 'C2']);
  });

  it('orders liftedBy by edgeScore desc, capped to 3', () => {
    const c = candidate({
      name: 'Multi',
      connectionCount: 4,
      clusterScore: 10,
      edges: [
        { seed: 'Weak', lift: 1, coPlayPct: 5, numDecks: 500 },
        { seed: 'Strongest', lift: 9, coPlayPct: 50, numDecks: 500 },
        { seed: 'Mid', lift: 4, coPlayPct: 20, numDecks: 500 },
        { seed: 'FourthPlace', lift: 3, coPlayPct: 15, numDecks: 500 },
      ],
    });
    const [pick] = selectTopLiftPicks([c]);
    expect(pick.liftedBy).toEqual(['Strongest', 'Mid', 'FourthPlace']);
    expect(pick.liftedBy).toHaveLength(3);
  });

  it('propagates lowSample from the candidate to the pick', () => {
    const c = candidate({ name: 'Thin', connectionCount: 2, clusterScore: 5, lowSample: true });
    const [pick] = selectTopLiftPicks([c]);
    expect(pick.lowSample).toBe(true);
  });
});
