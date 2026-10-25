// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ManaBaseMetrics } from '@/lib/mana-sim/mana-base-metrics';
import { DeckManaMath } from './DeckManaMath';

function metrics(over: Partial<ManaBaseMetrics> = {}): ManaBaseMetrics {
  return {
    runs: 2000,
    tapped: {
      lands: 7,
      lost: 1.37,
      actual: [0, 0.99, 1.9, 2.8, 3.7, 4.6],
      untapped: [0, 1, 2.1, 3.2, 4.3, 5.3],
    },
    tipping: {
      cost: '{2}{W}{U}',
      curve: [0, 0, 0, 0.1, 0.55, 0.83, 0.93, 0.97, 0.99],
      turns: [5, 6],
    },
    utilization: { games: 2000, turns: 6, mean: 0.612, median: 0.64, p10: 0.38 },
    ...over,
  };
}

describe('DeckManaMath', () => {
  it('reads the three numbers with the games behind them', () => {
    render(<DeckManaMath metrics={metrics()} pending={false} budget={6} bracket={3} />);
    expect(screen.getByText('1.4')).toBeTruthy();
    expect(screen.getByText('Turn 5')).toBeTruthy();
    expect(screen.getByText('61%')).toBeTruthy();
    expect(screen.getByText(/80% of games by then, 90% by turn 6/)).toBeTruthy();
    expect(screen.getByText('2,000 games')).toBeTruthy();
    expect(screen.getByText(/good to about 2.2 points/)).toBeTruthy();
  });

  it('does not repeat the turn when both bars are met on it', () => {
    const m = metrics();
    render(
      <DeckManaMath
        metrics={{ ...m, tipping: { ...m.tipping, turns: [3, 3] } }}
        pending={false}
        budget={6}
        bracket={3}
      />
    );
    expect(screen.getByText('A typical spell is castable in 90% of games by then.')).toBeTruthy();
  });

  it('shows the arithmetic: the per-turn gaps sum to the loss', () => {
    render(<DeckManaMath metrics={metrics()} pending={false} budget={6} bracket={3} />);
    const math = screen.getByText('Show the math').closest('details') as HTMLElement;
    expect(
      within(math).getByText(/0.01 \+ 0.20 \+ 0.40 \+ 0.60 \+ 0.70 = 1.37 mana-turns/)
    ).toBeTruthy();
    expect(within(math).getByText(/Bracket 3 expects games to last to turn 6/)).toBeTruthy();
  });

  it('says so when no land can enter tapped', () => {
    const m = metrics();
    render(
      <DeckManaMath
        metrics={{ ...m, tapped: { ...m.tapped, lands: 0, lost: 0 } }}
        pending={false}
        budget={6}
        bracket={null}
      />
    );
    expect(screen.getByText('No land here can enter tapped.')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('holds its place while the run is on its way and renders nothing with nothing to measure', () => {
    const { container, rerender } = render(
      <DeckManaMath metrics={null} pending budget={6} bracket={3} />
    );
    expect(container.querySelectorAll('.deck-manamath-skel span')).toHaveLength(3);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    rerender(<DeckManaMath metrics={null} pending={false} budget={6} bracket={3} />);
    expect(container.firstChild).toBeNull();
  });
});
