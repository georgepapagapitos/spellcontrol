// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toClockLibrary } from '@/lib/mana-sim/hand-classify';
import { simulateMulliganAdvice } from '@/lib/mana-sim/mulligan-advisor';
import { brago, BRAGO_UNTAPPED_DUALS } from '@/lib/mana-sim/__fixtures__/decks';
import { MulliganAdvice } from './MulliganAdvice';

const deck = brago(BRAGO_UNTAPPED_DUALS);
const library = toClockLibrary(deck.library).map((c) => c.mana!);
const commanders = toClockLibrary(deck.commanders).map((c) => c.mana!);
const advice = (hand: string[]) =>
  simulateMulliganAdvice({ commanders, library, hand, path: null, runs: 400 });

const SEVEN_LANDS = ['Plains', 'Island', 'Plains', 'Island', 'Command Tower', 'Plains', 'Island'];

describe('MulliganAdvice', () => {
  it('says what to do, which row decided it, and the numbers behind it', () => {
    const { container } = render(
      <MulliganAdvice advice={advice(SEVEN_LANDS)} pending={false} hasPath={false} />
    );
    expect(container.querySelector('strong.is-mulligan')?.textContent).toBe('Mulligan');
    expect(container.querySelector('.deck-test-hand-advice-verdict')?.textContent).toMatch(
      /4 or more spells cast by turn 5: \d+% with this hand, \d+% with a fresh seven\./
    );
    const deciding = container.querySelectorAll('tr.is-deciding');
    expect(deciding).toHaveLength(1);
    expect(deciding[0].textContent).toContain('Decides');
    // Every cell carries its range, and the heading names the run size, not the test's.
    expect(container.querySelectorAll('.deck-test-hand-advice-range')).toHaveLength(9);
    expect(container.textContent).toContain('2,000 games each');
  });

  it('holds the same rows while the run is on its way', () => {
    const done = render(
      <MulliganAdvice advice={advice(SEVEN_LANDS)} pending={false} hasPath={false} />
    ).container;
    const wait = render(<MulliganAdvice advice={null} pending hasPath={false} />).container;
    expect(wait.querySelectorAll('tbody tr')).toHaveLength(
      done.querySelectorAll('tbody tr').length
    );
    expect(wait.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
    expect(wait.querySelector('strong.is-mulligan')).toBeNull();
  });

  it('adds the win path row only when the deck has a timed path', () => {
    const rows = (hasPath: boolean) =>
      render(<MulliganAdvice advice={null} pending hasPath={hasPath} />).container.querySelectorAll(
        'tbody tr'
      ).length;
    expect(rows(true)).toBe(rows(false) + 1);
  });
});
