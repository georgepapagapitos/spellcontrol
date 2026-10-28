// @vitest-environment node
// E1044: the budget last resort's bookkeeping around applyBudgetConvergence.
import { describe, expect, it } from 'vitest';
import type { GenerationState } from './state';
import { runBudgetLastResort, standingBudgetSwaps, type BudgetTally } from './budgetLastResort';

const repair = (cut: string, added: string) => ({ cut, added, reason: '' });
const tally = (over: Partial<BudgetTally> = {}): BudgetTally => ({
  detectedCombos: undefined,
  budgetRepairs: [repair('Smaug, Wicked Worm', 'Encroaching Dragonstorm')],
  budgetConvergedSwaps: 1,
  budgetResidualReason: 'no cheaper alternative for the remaining cards',
  lastResortSwaps: 0,
  ...over,
});

describe('runBudgetLastResort', () => {
  it('leaves the tally alone when no budget was asked', async () => {
    const before = tally();
    expect(await runBudgetLastResort({} as GenerationState, null, before)).toBe(before);
  });
});

describe('standingBudgetSwaps', () => {
  it('never lets the search reverse a last-resort swap made after it', () => {
    // The search swapped out the same-role stage's Encroaching Dragonstorm;
    // the last resort then cut Frontier Siege, which the search had added.
    const state = {
      wholeDeckSearch: {
        swaps: [{ cut: 'Encroaching Dragonstorm', added: 'Frontier Siege', reason: '' }],
        note: '',
      },
    } as GenerationState;
    const t = tally({
      budgetRepairs: [
        repair('Smaug, Wicked Worm', 'Encroaching Dragonstorm'),
        repair('Frontier Siege', 'Purging Stormbrood // Absorb Essence'),
      ],
      budgetConvergedSwaps: 2,
      lastResortSwaps: 1,
    });
    // The first repair was reversed by the search; the last-resort one stands.
    expect(standingBudgetSwaps(state, t)).toBe(1);
  });
});
