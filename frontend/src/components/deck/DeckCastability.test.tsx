// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CastabilityReport, CastabilityRow } from '@/lib/deck-analysis/castability';
import { DeckCastability } from './DeckCastability';

/** Rows shaped like the engine's answer for a real Henzie list (4,000 games). */
function row(name: string, rate: number, bar: number, mv: number, short = 0.1): CastabilityRow {
  return {
    name,
    cost: '{4}{R}{R}',
    mv,
    rate,
    bar,
    short: { symbol: 'R', share: short },
    commander: false,
  };
}

const UNDER = [
  row('Incinerator of the Guilty', 0.898, 0.95, 6),
  { ...row('Henzie "Toolbox" Torre', 0.906, 0.92, 3, 0.07), commander: true },
  row('Etali, Primal Conqueror', 0.944, 0.96, 7, 0.06),
];

function report(over: Partial<CastabilityReport> = {}): CastabilityReport {
  return {
    games: 4000,
    measured: 66,
    average: 0.965,
    under: UNDER,
    atBar: [row('Massacre Wurm', 0.947, 0.95, 6)],
    tightSymbol: 'R',
    ...over,
  };
}

describe('DeckCastability', () => {
  it('tells the owner what to add, card by card', () => {
    render(<DeckCastability report={report()} owner />);
    expect(screen.getByText('Red is your tight color. Add red sources.')).toBeTruthy();
    expect(screen.getByText('3 under the bar')).toBeTruthy();
    expect(
      screen.getByText(
        'With the mana there, your spells have their colors on curve 97% of the time.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Turn 6 · needs 95%')).toBeTruthy();
    expect(screen.getByText(/short on red in 10% of games/)).toBeTruthy();
    expect(screen.getByText('At the bar:')).toBeTruthy();
    expect(screen.getByText('Over 4,000 goldfish games.')).toBeTruthy();
  });

  it('describes the deck to a visitor and leads with the worst card', () => {
    render(<DeckCastability report={report()} owner={false} />);
    expect(screen.getByText("Red is this deck's tight color.")).toBeTruthy();
    expect(screen.queryByText(/Add red sources/)).toBeNull();
    expect(screen.getByText('Incinerator of the Guilty')).toBeTruthy();
    expect(screen.queryByText('Etali, Primal Conqueror')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 3' }));
    expect(screen.getByText('Etali, Primal Conqueror')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
  });

  it('says so in one line when every spell clears the bar', () => {
    render(<DeckCastability report={report({ under: [], atBar: [], tightSymbol: null })} owner />);
    expect(screen.getByText('66 of 66 pass')).toBeTruthy();
    expect(screen.getByText(/Every spell has its colors on curve\. 97% on average\./)).toBeTruthy();
    expect(screen.queryByText(/tight color/)).toBeNull();
  });

  it('names a commander whose cost changes the simulation leaves out', () => {
    render(<DeckCastability report={report()} owner costChangedBy={'Henzie "Toolbox" Torre'} />);
    expect(
      screen.getByText(
        'Over 4,000 goldfish games. Henzie "Toolbox" Torre\'s cost changes aren\'t counted.'
      )
    ).toBeTruthy();
  });

  it('opens a card preview from a name when there is one to open', () => {
    const onShowCard = vi.fn();
    render(<DeckCastability report={report()} owner onShowCard={onShowCard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Massacre Wurm' }));
    expect(onShowCard).toHaveBeenCalledWith('Massacre Wurm');
  });
});
