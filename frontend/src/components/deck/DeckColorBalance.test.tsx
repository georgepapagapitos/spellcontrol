// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeckColorBalance } from './DeckColorBalance';

describe('DeckColorBalance', () => {
  it('renders a row for each color that has demand or production', () => {
    const { container } = render(
      <DeckColorBalance
        colorRequirements={{ W: 20, U: 0, B: 15, R: 8, G: 12 }}
        colorProduction={{ W: 18, U: 0, B: 14, R: 9, G: 11 }}
      />
    );
    const rows = container.querySelectorAll('.deck-color-balance-row');
    // W, B, R, G are present; U has neither demand nor production → omitted.
    expect(rows.length).toBe(4);
    expect(screen.getByText('White')).toBeTruthy();
    expect(screen.getByText('Black')).toBeTruthy();
    expect(screen.getByText('Red')).toBeTruthy();
    expect(screen.getByText('Green')).toBeTruthy();
    expect(screen.queryByText('Blue')).toBeNull();
  });

  it('shows demand and source values per color', () => {
    const { container } = render(
      <DeckColorBalance colorRequirements={{ W: 20 }} colorProduction={{ W: 18 }} />
    );
    const values = Array.from(container.querySelectorAll('.deck-color-balance-meter-value')).map(
      (n) => n.textContent
    );
    expect(values).toEqual(['20', '18']);
  });

  it('flags a shortfall when production is well below demand', () => {
    // B: demand 15, production 4 → 4 < 15 * 0.6 (9) → short.
    render(<DeckColorBalance colorRequirements={{ B: 15 }} colorProduction={{ B: 4 }} />);
    expect(screen.getByText('Sources short')).toBeTruthy();
  });

  it('does not flag a color whose sources comfortably meet demand', () => {
    // R: demand 8, production 9 → no flag.
    render(<DeckColorBalance colorRequirements={{ R: 8 }} colorProduction={{ R: 9 }} />);
    expect(screen.queryByText('Sources short')).toBeNull();
  });

  it('does not flag a tiny splash even when sources are below the ratio', () => {
    // R: demand 2, production 1 → 1 < 2 * 0.6 (1.2) but demand < MIN_FLAG_DEMAND (3)
    // and production > 0 → small-splash forgiveness, no flag.
    render(<DeckColorBalance colorRequirements={{ R: 2 }} colorProduction={{ R: 1 }} />);
    expect(screen.queryByText('Sources short')).toBeNull();
  });

  it('flags a color with demand but zero sources even when demand is small', () => {
    // B: demand 2, production 0 → you can't produce a color you need → always flag.
    render(<DeckColorBalance colorRequirements={{ B: 2 }} colorProduction={{ B: 0 }} />);
    expect(screen.getByText('Sources short')).toBeTruthy();
  });

  it('never flags a color with zero demand and renders it neutral', () => {
    const { container } = render(
      <DeckColorBalance colorRequirements={{ G: 0 }} colorProduction={{ G: 5 }} />
    );
    expect(screen.queryByText('Sources short')).toBeNull();
    const row = container.querySelector('.deck-color-balance-row');
    expect(row?.classList.contains('deck-color-balance-row-neutral')).toBe(true);
  });

  it('shows an empty message with no colored mana', () => {
    render(<DeckColorBalance colorRequirements={{}} colorProduction={{}} />);
    expect(screen.getByText('No colored mana to balance.')).toBeTruthy();
  });

  it('makes rows tappable and adds a colorless row when sources are provided', () => {
    render(
      <DeckColorBalance
        colorRequirements={{ W: 10 }}
        colorProduction={{ W: 8, C: 3 }}
        sourcesByColor={{
          W: [{ name: 'Plains', count: 7 }],
          C: [{ name: 'Sol Ring', count: 1 }],
        }}
        onShowSources={() => {}}
      />
    );

    // White has a source list → its row is a button labeled with the unique count.
    expect(screen.getByRole('button', { name: /Show the 1 White mana sources/ })).toBeTruthy();
    // Colorless production surfaces its own tappable row.
    expect(screen.getByText('Colorless')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Show the 1 colorless mana sources/ })).toBeTruthy();
  });

  it('shows a colorless row even when there is no colored demand', () => {
    render(<DeckColorBalance colorRequirements={{}} colorProduction={{ C: 5 }} />);
    expect(screen.queryByText('No colored mana to balance.')).toBeNull();
    expect(screen.getByText('Colorless')).toBeTruthy();
  });
});
