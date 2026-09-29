import { describe, expect, it } from 'vitest';
import type { WinConditionAnalysis } from '@/deck-builder/services/winConditions/types';
import { buildWinConditionSummary } from './win-condition-summary';

const noClear = {
  primary: null,
  secondary: [],
  noClearWinCondition: true,
} as unknown as WinConditionAnalysis;

describe('buildWinConditionSummary', () => {
  it('names no clear win condition once combos are counted', () => {
    expect(buildWinConditionSummary(noClear)).toBe('No clear win condition');
  });

  it('does not claim it before combos are counted: a combo may be the win', () => {
    expect(buildWinConditionSummary(noClear, true)).toBe(
      'Win condition unclear until combos are counted'
    );
  });

  it('is undefined without an analysis', () => {
    expect(buildWinConditionSummary(undefined, true)).toBeUndefined();
  });
});
