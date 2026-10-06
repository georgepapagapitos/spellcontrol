// @vitest-environment node
// E513 round 2: the budget note counts the substitutions still standing.
import { describe, expect, it } from 'vitest';
import type { GenerationState } from './state';
import {
  SEARCH_PROGRESS_MESSAGE,
  SEARCH_PROGRESS_PERCENT,
  searchEnabled,
  standing,
} from './wholeDeckSearchStep';

const repair = (cut: string, added: string) => ({ cut, added, reason: '' });
const stateWith = (swaps: Array<{ cut: string; added: string }>) =>
  ({
    wholeDeckSearch: { swaps: swaps.map((s) => ({ ...s, reason: '' })), note: '' },
  }) as GenerationState;

describe('standing budget substitutions', () => {
  const repairs = [
    repair('Skrelv, Defector Mite', 'Tainted Observer'),
    repair('Insight Engine', 'Plague Myr'),
    repair('Sensei Golden-Tail', 'Hapatra, the Desert Frost'),
  ];

  it('is the count the note was given when the search changed nothing', () => {
    expect(standing({} as GenerationState, repairs, 8)).toBe(8);
  });

  it('drops a substitution whose card came back and one whose add went', () => {
    const state = stateWith([
      { cut: 'Viridian Corrupter', added: 'Skrelv, Defector Mite' },
      { cut: 'Hapatra, the Desert Frost', added: 'Reject Imperfection' },
    ]);
    expect(standing(state, repairs, 8)).toBe(6);
  });
});

describe('the search is on unless a build says false', () => {
  it('runs for an unset flag and a true one, and skips an explicit false', () => {
    expect(searchEnabled({})).toBe(true);
    expect(searchEnabled({ wholeDeckSearch: true })).toBe(true);
    expect(searchEnabled({ wholeDeckSearch: false })).toBe(false);
  });

  it('has a progress step the takeover lists, and the bar can move on past it', () => {
    expect(SEARCH_PROGRESS_MESSAGE).toBe('Fine-tuning the list…');
    expect(SEARCH_PROGRESS_PERCENT).toBeGreaterThan(92);
    expect(SEARCH_PROGRESS_PERCENT).toBeLessThan(97);
  });
});
