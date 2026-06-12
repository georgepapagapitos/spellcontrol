import { describe, it, expect } from 'vitest';
import { rankCoachMoves, type CoachContext } from './coach-rank';
import type { Change } from './deck-change';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';

// ── Minimal Change factory ────────────────────────────────────────────────────

function makeChange(over: Partial<Change> & { name: string; lane: Change['lane'] }): Change {
  return {
    id: `${over.lane}:${over.name}`,
    type: 'add',
    reason: 'test reason',
    ...over,
  };
}

// ── Minimal PlanScore factory ────────────────────────────────────────────────

function makePlanScore(
  subscoreValues: Partial<Record<'strategy' | 'roles' | 'curve' | 'cardFit', number>>
): PlanScore {
  const makeSubScore = (value: number) => ({
    value,
    surface: 'test',
    bandLabel: value >= 75 ? 'Healthy' : 'Thin',
    partial: false,
  });
  return {
    overall: 50,
    bandLabel: 'Solid',
    headline: 'test',
    byline: 'test',
    limitedData: false,
    subscores: {
      strategy: makeSubScore(subscoreValues.strategy ?? 80),
      roles: makeSubScore(subscoreValues.roles ?? 80),
      curve: makeSubScore(subscoreValues.curve ?? 80),
      cardFit: makeSubScore(subscoreValues.cardFit ?? 80),
    },
  };
}

// ── Base context ─────────────────────────────────────────────────────────────

const BASE_CTX: CoachContext = {
  roleCounts: { ramp: 8, removal: 6 },
  roleTargets: { ramp: 10, removal: 8 },
  deckSize: 99,
  deckTarget: 99,
  bracketOverridePresent: false,
  ownedNames: new Set(),
};

// ── Fixture 1: gap-heavy precon-like deck ─────────────────────────────────────

describe('Fixture 1: gap-heavy precon (roles=45, all subscores below 60)', () => {
  const planScore = makePlanScore({ roles: 45, cardFit: 55, strategy: 40, curve: 70 });
  const ctx: CoachContext = {
    ...BASE_CTX,
    planScore,
    roleCounts: { ramp: 3, removal: 2, boardwipe: 0, cardDraw: 1 },
    roleTargets: { ramp: 10, removal: 8, boardwipe: 4, cardDraw: 8 },
    deckSize: 95,
    deckTarget: 99,
    ownedNames: new Set(['Sol Ring', 'Arcane Signet']),
  };

  const changes: Change[] = [
    makeChange({ name: 'Sol Ring', lane: 'fill-gaps', ownership: 'owned', inclusion: 90 }),
    makeChange({ name: 'Arcane Signet', lane: 'fill-gaps', ownership: 'owned', inclusion: 85 }),
    makeChange({
      name: 'Swords to Plowshares',
      lane: 'fill-gaps',
      ownership: 'unowned',
      inclusion: 70,
    }),
    makeChange({ name: 'Rhystic Study', lane: 'upgrade', ownership: 'unowned', inclusion: 65 }),
    makeChange({ name: "Thassa's Oracle", lane: 'combos', ownership: 'unowned' }),
    makeChange({ name: 'Opt', lane: 'budget', type: 'swap', inName: 'Jace', ownership: 'unowned' }),
    makeChange({ name: 'Evacuation', lane: 'bracket-fit', ownership: 'unowned', inclusion: 40 }),
  ];

  it('fill-gaps changes are tier 1 when roles < 60', () => {
    const ranked = rankCoachMoves(changes, ctx);
    const fillGaps = ranked.filter((r) => r.change.lane === 'fill-gaps');
    expect(fillGaps.length).toBeGreaterThan(0);
    fillGaps.forEach((r) => expect(r.tier).toBe(1));
  });

  it('upgrade changes are tier 1 when cardFit < 60', () => {
    const ranked = rankCoachMoves(changes, ctx);
    const upgrades = ranked.filter((r) => r.change.lane === 'upgrade');
    expect(upgrades.length).toBeGreaterThan(0);
    upgrades.forEach((r) => expect(r.tier).toBe(1));
  });

  it('combos and budget are always tier 3', () => {
    const ranked = rankCoachMoves(changes, ctx);
    const t3 = ranked.filter((r) => r.change.lane === 'combos' || r.change.lane === 'budget');
    t3.forEach((r) => expect(r.tier).toBe(3));
  });

  it('every source kind is represented in the output', () => {
    const ranked = rankCoachMoves(changes, ctx);
    const lanes = new Set(ranked.map((r) => r.change.lane));
    expect(lanes.has('fill-gaps')).toBe(true);
    expect(lanes.has('upgrade')).toBe(true);
    expect(lanes.has('combos')).toBe(true);
    expect(lanes.has('budget')).toBe(true);
    expect(lanes.has('bracket-fit')).toBe(true);
  });
});

// ── Fixture 2: well-tuned deck ─────────────────────────────────────────────────

describe('Fixture 2: well-tuned deck (all subscores >= 80)', () => {
  const planScore = makePlanScore({ roles: 85, cardFit: 82, strategy: 80, curve: 90 });
  const ctx: CoachContext = {
    ...BASE_CTX,
    planScore,
    ownedNames: new Set(['Esper Sentinel']),
  };

  const changes: Change[] = [
    makeChange({ name: "Thassa's Oracle", lane: 'combos', ownership: 'unowned' }),
    makeChange({
      name: 'Budget Land',
      lane: 'budget',
      type: 'swap',
      inName: 'Expensive Land',
      ownership: 'unowned',
    }),
    makeChange({ name: 'Rhystic Study', lane: 'upgrade', ownership: 'unowned', inclusion: 65 }),
    makeChange({ name: 'Esper Sentinel', lane: 'bracket-fit', ownership: 'owned', inclusion: 40 }),
  ];

  it('everything is tier 3 when all subscores >= 75', () => {
    const ranked = rankCoachMoves(changes, ctx);
    ranked.forEach((r) => expect(r.tier).toBe(3));
  });

  it('every source kind is represented', () => {
    const ranked = rankCoachMoves(changes, ctx);
    const lanes = new Set(ranked.map((r) => r.change.lane));
    expect(lanes.has('combos')).toBe(true);
    expect(lanes.has('budget')).toBe(true);
    expect(lanes.has('upgrade')).toBe(true);
    expect(lanes.has('bracket-fit')).toBe(true);
  });
});

// ── Fixture 3: over-budget deck ────────────────────────────────────────────────

describe('Fixture 3: over-budget deck (tuned quality, several budget swaps)', () => {
  const planScore = makePlanScore({ roles: 88, cardFit: 85, strategy: 80, curve: 90 });
  const ctx: CoachContext = {
    ...BASE_CTX,
    planScore,
    ownedNames: new Set(['Sol Ring', 'Command Tower']),
  };

  const changes: Change[] = [
    makeChange({
      name: 'Cheaper Land',
      lane: 'budget',
      type: 'swap',
      inName: 'Expensive Land',
      ownership: 'owned',
    }),
    makeChange({
      name: 'Budget Counterspell',
      lane: 'budget',
      type: 'swap',
      inName: 'Counterspell',
      ownership: 'unowned',
    }),
    makeChange({ name: "Thassa's Oracle", lane: 'combos', ownership: 'unowned' }),
    makeChange({ name: 'Better Creature', lane: 'upgrade', ownership: 'unowned', inclusion: 55 }),
  ];

  it('budget swaps are tier 3 in a tuned deck', () => {
    const ranked = rankCoachMoves(changes, ctx);
    const budget = ranked.filter((r) => r.change.lane === 'budget');
    budget.forEach((r) => expect(r.tier).toBe(3));
  });

  it('owned changes come before unowned within a tier', () => {
    const ranked = rankCoachMoves(changes, ctx);
    const tier3 = ranked.filter((r) => r.tier === 3);
    // Find owned and unowned budget changes
    const ownedBudget = tier3.findIndex(
      (r) => r.change.ownership === 'owned' && r.change.lane === 'budget'
    );
    const unownedBudget = tier3.findIndex(
      (r) => r.change.ownership === 'unowned' && r.change.lane === 'budget'
    );
    // Both should exist and owned should appear first
    expect(ownedBudget).toBeGreaterThanOrEqual(0);
    expect(unownedBudget).toBeGreaterThanOrEqual(0);
    expect(ownedBudget).toBeLessThan(unownedBudget);
  });

  it('output is deterministic — same input → same order', () => {
    const ranked1 = rankCoachMoves([...changes], ctx);
    const ranked2 = rankCoachMoves([...changes], ctx);
    expect(ranked1.map((r) => r.change.name)).toEqual(ranked2.map((r) => r.change.name));
  });
});

// ── Swap convention lock test ─────────────────────────────────────────────────

describe('swap convention lock: name=incoming, inName=outgoing', () => {
  it('fromBracketFitMove produces swap where name=incoming (replacement) and inName=cut', () => {
    // This is a data-layer test, verifying the adapter convention used by CoachFeed.
    // When the ranker processes a swap Change, the primary card (name) is the one
    // coming IN and inName is the one being cut.
    const swapChange = makeChange({
      name: 'Evacuation', // INCOMING replacement
      lane: 'bracket-fit',
      type: 'swap',
      inName: 'Cyclonic Rift', // OUTGOING card being cut
      ownership: 'unowned',
    });
    // The ranker should preserve this convention
    const ranked = rankCoachMoves([swapChange], { ...BASE_CTX });
    expect(ranked[0].change.name).toBe('Evacuation');
    expect(ranked[0].change.inName).toBe('Cyclonic Rift');
  });
});
