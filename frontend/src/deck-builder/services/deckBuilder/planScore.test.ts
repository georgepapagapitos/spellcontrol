import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CurvePhaseAnalysis, CurvePhase } from './deckAnalyzer';

// Tagger isn't loaded in tests — make every card role-less so misfit counts are
// deterministic (the cardFit dimension still works off inclusion/synergy).
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: (): string | null => null,
}));

import {
  computePlanScore,
  computeStrategyFromEngine,
  computeRolesSubscore,
  computeTempoSubscore,
  roleSlotsFromCounts,
  roleSlotsFromDeficits,
  bandFor,
  type PlanScoreInput,
  type RoleSlot,
} from './planScore';

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Creature — Human',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  };
}

function phase(p: CurvePhase, current: number, target: number): CurvePhaseAnalysis {
  return {
    phase: p,
    label: p,
    cmcRange: [0, 2],
    current,
    target,
    delta: current - target,
    cards: [],
    pctOfDeck: 0,
    avgCmc: 0,
    grade: { letter: 'A', message: '' },
    rampInPhase: 0,
    interactionInPhase: 0,
    cardDrawInPhase: 0,
    phaseRoleBreakdowns: [],
  };
}

// Healthy deck inputs: every role on target, every phase on target.
function healthyInput(): PlanScoreInput {
  return {
    roleCounts: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
    roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
    curvePhases: [phase('early', 12, 12), phase('mid', 8, 8), phase('late', 4, 4)],
    misfitInputs: { cards: [], cardInclusionMap: {} },
    gapCount: 0,
  };
}

describe('bandFor', () => {
  it('maps thresholds', () => {
    expect(bandFor(95)).toBe('Tuned');
    expect(bandFor(90)).toBe('Tuned');
    expect(bandFor(80)).toBe('Healthy');
    expect(bandFor(65)).toBe('Solid');
    expect(bandFor(50)).toBe('Rough');
    expect(bandFor(10)).toBe('Thin');
  });
});

describe('computeStrategyFromEngine', () => {
  it('is partial when no engine is detected (control / goodstuff)', () => {
    expect(computeStrategyFromEngine(null).partial).toBe(true);
    expect(
      computeStrategyFromEngine({
        primaryLabel: null,
        primaryProducers: 0,
        primaryPayoffs: 0,
        engineCards: 0,
        nonLandCount: 60,
      }).partial
    ).toBe(true);
  });

  it('rewards a committed, balanced engine', () => {
    // 18/60 = 0.30 density = full; balance 8/10 ≥ 0.4 = full → 100.
    const s = computeStrategyFromEngine({
      primaryLabel: 'Tokens / go-wide',
      primaryProducers: 10,
      primaryPayoffs: 8,
      engineCards: 18,
      nonLandCount: 60,
    });
    expect(s.partial).toBeUndefined();
    expect(s.value).toBe(100);
    expect(s.surface).toMatch(/10 producers \/ 8 payoffs/);
  });

  it('penalizes a payoff-starved engine via the balance term', () => {
    // density full (18/60) but balance 1/10 = 0.1 → balanceScore 0.25.
    const s = computeStrategyFromEngine({
      primaryLabel: 'Tokens / go-wide',
      primaryProducers: 10,
      primaryPayoffs: 1,
      engineCards: 18,
      nonLandCount: 60,
    });
    // 0.6*1 + 0.4*0.25 = 0.7 → 70, below the balanced 100.
    expect(s.value).toBe(70);
  });
});

describe('computeRolesSubscore', () => {
  it('is partial when no role targets', () => {
    const s = computeRolesSubscore([{ role: 'ramp', current: 0, target: 0 }]);
    expect(s.partial).toBe(true);
  });

  it('scores 100 when all roles on target', () => {
    const slots = roleSlotsFromCounts(
      { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
      { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 }
    );
    expect(computeRolesSubscore(slots).value).toBe(100);
  });

  it('applies the overshoot half-penalty', () => {
    // current 12 / target 10 = ratio 1.2 → norm = 1 - 0.2*0.5 = 0.9 → 90.
    const slots: RoleSlot[] = [{ role: 'ramp', current: 12, target: 10 }];
    expect(computeRolesSubscore(slots).value).toBe(90);
  });

  it('caps the ratio at 1.2 (a huge overshoot bottoms at 0.9)', () => {
    const slots: RoleSlot[] = [{ role: 'ramp', current: 50, target: 10 }];
    expect(computeRolesSubscore(slots).value).toBe(90);
  });

  it('penalizes deficits below target', () => {
    // current 5 / target 10 = 0.5 → 50.
    const slots: RoleSlot[] = [{ role: 'ramp', current: 5, target: 10 }];
    expect(computeRolesSubscore(slots).value).toBe(50);
  });

  it('roleSlotsFromDeficits passes through current/target', () => {
    const slots = roleSlotsFromDeficits([
      { role: 'ramp', label: 'Ramp', current: 4, target: 10, deficit: 6 },
    ]);
    expect(slots).toEqual([{ role: 'ramp', current: 4, target: 10 }]);
  });
});

describe('computeTempoSubscore', () => {
  it('is partial with no phase data', () => {
    expect(computeTempoSubscore([]).partial).toBe(true);
  });

  it('scores 100 when every phase is on target', () => {
    const s = computeTempoSubscore([
      phase('early', 12, 12),
      phase('mid', 8, 8),
      phase('late', 4, 4),
    ]);
    expect(s.value).toBe(100);
  });

  it('weights early gaps heaviest and names the weakest phase', () => {
    // early light (6/12=0.5), mid/late on target. early weight 1.4 dominates.
    const s = computeTempoSubscore([
      phase('early', 6, 12),
      phase('mid', 8, 8),
      phase('late', 4, 4),
    ]);
    // weighted = 0.5*1.4 + 1*1 + 1*0.7 = 2.4 ; total = 3.1 ; 0.7742 → 77
    expect(s.value).toBe(77);
    expect(s.surface).toMatch(/early/);
  });
});

describe('computePlanScore', () => {
  it('drops a partial strategy dim without tanking overall', () => {
    const ps = computePlanScore(healthyInput());
    expect(ps.subscores.strategy.partial).toBe(true);
    expect(ps.limitedData).toBe(true);
    // roles=100, tempo=100, cardFit=100 → overall 100, NOT diluted by a 0 strategy.
    expect(ps.overall).toBe(100);
    expect(ps.bandLabel).toBe('Tuned');
  });

  it('includes strategy in the composite when an engine is present', () => {
    const input = healthyInput();
    // density 1 (12/12 engine cards) + balance 0.2 (10 producers / 2 payoffs →
    // balanceScore 0.5) → strategy = round((0.6 + 0.2) * 100) = 80.
    input.strategyEngine = {
      primaryLabel: 'Tokens',
      primaryProducers: 10,
      primaryPayoffs: 2,
      engineCards: 12,
      nonLandCount: 12,
    };
    const ps = computePlanScore(input);
    expect(ps.subscores.strategy.partial).toBeUndefined();
    expect(ps.limitedData).toBe(false);
    // strategy=80 (0.30), roles=100 (0.25), tempo=100 (0.20), cardFit=100 (0.25)
    // = (80*.3 + 100*.7) / 1.0 = 94
    expect(ps.overall).toBe(94);
  });

  it('weighted average uses only non-partial denominators', () => {
    // Only cardFit (with misfits) non-partial besides roles/tempo; strategy partial.
    const input = healthyInput();
    input.roleTargets = {}; // roles partial
    input.roleCounts = {};
    input.curvePhases = []; // tempo partial
    // cardFit alone non-partial → overall == cardFit value (100, no misfits/gaps).
    const ps = computePlanScore(input);
    expect(ps.subscores.roles.partial).toBe(true);
    expect(ps.subscores.tempo.partial).toBe(true);
    expect(ps.overall).toBe(ps.subscores.cardFit.value);
  });

  it('degenerate empty deck: everything partial → overall 0', () => {
    const ps = computePlanScore({
      roleCounts: {},
      roleTargets: {},
      curvePhases: [],
      misfitInputs: { cards: [], cardInclusionMap: {} },
      gapCount: 0,
    });
    // cardFit on an empty deck is still 100 (no misfits, no gaps) and non-partial,
    // so overall == 100 here; strategy/roles/tempo are all partial.
    expect(ps.subscores.cardFit.partial).toBeUndefined();
    expect(ps.overall).toBe(100);
    expect(ps.limitedData).toBe(true);
  });

  it('cardFit pulls overall down when there are misfits and gaps', () => {
    const input = healthyInput();
    input.misfitInputs = {
      cards: [card('Bad1'), card('Bad2')], // absent incl + absent syn + role-missing each
      cardInclusionMap: {},
    };
    input.gapCount = 4;
    const ps = computePlanScore(input);
    // 2 misfits → -16, 4 gaps → -6 → cardFit 78.
    expect(ps.subscores.cardFit.value).toBe(78);
    expect(ps.overall).toBeLessThan(100);
  });

  it('byline cites sample size when provided', () => {
    const input = healthyInput();
    input.sampleSize = 12345;
    expect(computePlanScore(input).byline).toBe('Based on 12,345 decklists.');
    delete input.sampleSize;
    expect(computePlanScore(input).byline).toMatch(/aggregated EDHREC/);
  });
});
