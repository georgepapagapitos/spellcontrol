// @vitest-environment node
// E513 round 2: the budget note counts the substitutions still standing.
import { describe, expect, it } from 'vitest';
import type { GenerationState } from './state';
import { standing } from './wholeDeckSearchStep';

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
