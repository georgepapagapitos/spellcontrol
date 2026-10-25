import { describe, expect, it } from 'vitest';
import type { WinConditionAnalysis } from '@/deck-builder/services/winConditions/types';
import { isKillClock, speedPathOf } from './speed-path';

const analysis = (primary: WinConditionAnalysis['primary'], tutors?: string[]) =>
  ({ primary, secondary: [], noClearWinCondition: !primary, tutors }) as WinConditionAnalysis;

const win = (
  category: 'infinite-combo' | 'go-wide' | 'combat',
  assembly?: { names: string[]; need: number }[]
) => ({
  category,
  label: category,
  summary: '',
  evidence: [],
  score: 10,
  assembly,
});

describe('isKillClock', () => {
  it('is true only for paths that end the game on assembly', () => {
    expect(isKillClock('infinite-combo')).toBe(true);
    expect(isKillClock('alt-win')).toBe(true);
    expect(isKillClock('go-wide')).toBe(false);
    expect(isKillClock('combat')).toBe(false);
  });
});

describe('speedPathOf', () => {
  it('times a combo with its tutors', () => {
    const p = speedPathOf(
      analysis(
        win('infinite-combo', [{ names: ['Thassa’s Oracle', 'Demonic Consultation'], need: 2 }]),
        ['Demonic Tutor']
      )
    );
    expect(p?.assembly).toHaveLength(1);
    expect(p?.tutors).toEqual(['Demonic Tutor']);
  });

  it('has nothing to time for a strategic plan, generic combat, or no path', () => {
    expect(speedPathOf(analysis(win('go-wide', [{ names: ['A', 'B'], need: 2 }])))).toBeNull();
    expect(speedPathOf(analysis(win('combat')))).toBeNull();
    expect(speedPathOf(analysis(null))).toBeNull();
    expect(speedPathOf(undefined)).toBeNull();
  });

  it('drops an option with no library piece: it would read as turn 1 in every game', () => {
    // Quick Draw (Stella Lee precon): its one complete combo is the commander alone.
    expect(speedPathOf(analysis(win('infinite-combo', [{ names: [], need: 0 }])))).toBeNull();
    const p = speedPathOf(
      analysis(
        win('infinite-combo', [
          { names: [], need: 0 },
          { names: ['A', 'B'], need: 2 },
        ])
      )
    );
    expect(p?.assembly).toEqual([{ names: ['A', 'B'], need: 2 }]);
  });
});
