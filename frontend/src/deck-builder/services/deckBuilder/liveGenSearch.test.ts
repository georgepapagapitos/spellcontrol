import { describe, expect, it } from 'vitest';
import { DETERMINISTIC_SEARCH_BUDGET_MS, liveSearchBudgetMs } from './liveGenSearch';
import { SEARCH_TIME_BUDGET_MS } from './deckGeneration/phaseWholeDeckSearch';

describe('live panel search budget (E638)', () => {
  it('lifts the wall clock by default, so the search ends on its evaluation cap', () => {
    expect(liveSearchBudgetMs({})).toBe(DETERMINISTIC_SEARCH_BUDGET_MS);
    // Far past the app's clock: on a busy machine the 15 s budget is what
    // stopped the search early and made two runs of one commit differ.
    expect(DETERMINISTIC_SEARCH_BUDGET_MS).toBeGreaterThanOrEqual(40 * SEARCH_TIME_BUDGET_MS);
  });

  it('keeps the app clock when LIVE_GEN_SEARCH_CLOCK=1', () => {
    expect(liveSearchBudgetMs({ LIVE_GEN_SEARCH_CLOCK: '1' })).toBeUndefined();
    expect(liveSearchBudgetMs({ LIVE_GEN_SEARCH_CLOCK: '0' })).toBe(DETERMINISTIC_SEARCH_BUDGET_MS);
  });
});
