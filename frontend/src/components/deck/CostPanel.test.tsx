// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CostPlan, CostSwapRow } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import { CostPanel } from './CostPanel';

function row(over: Partial<CostSwapRow> & { id: string }): CostSwapRow {
  return {
    currentName: over.id,
    currentPrice: 10,
    currentInclusion: 60,
    suggestionName: `${over.id}-alt`,
    suggestionPrice: 2,
    suggestionInclusion: 50,
    savings: 8,
    confidence: 'drop-in',
    category: 'spell',
    ...over,
  };
}

const plan: CostPlan = {
  currentTotal: 30,
  minTotal: 6,
  spellRows: [
    row({ id: 'Sol Ring', savings: 8, confidence: 'drop-in' }),
    row({ id: 'Cyclonic Rift', savings: 6, confidence: 'sidegrade' }),
    row({ id: 'Mana Crypt', savings: 10, confidence: 'budget' }),
  ],
  landRows: [row({ id: 'Gaea Cradle', category: 'land', savings: 4, confidence: 'drop-in' })],
  protectedCount: 2,
};

describe('CostPanel', () => {
  it('renders spell and land rows with both card names', () => {
    render(<CostPanel plan={plan} onApply={() => {}} />);
    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('Sol Ring-alt')).toBeTruthy();
    expect(screen.getByText('Gaea Cradle')).toBeTruthy();
    expect(screen.getByLabelText('Spells')).toBeTruthy();
    expect(screen.getByLabelText('Lands')).toBeTruthy();
  });

  it('shows the empty state when there are no rows', () => {
    render(
      <CostPanel
        plan={{ currentTotal: 0, minTotal: 0, spellRows: [], landRows: [], protectedCount: 0 }}
        onApply={() => {}}
      />
    );
    expect(screen.getByText(/already lean/)).toBeTruthy();
  });

  it('defaults drop-in + sidegrade checked and reflects them in the projected total', () => {
    render(<CostPanel plan={plan} onApply={() => {}} />);
    const summary = screen.getByRole('region', { name: 'Cost plan summary' });
    // Checked by default: 2 drop-in (8 + 4) + 1 sidegrade (6) = 18 savings. 30 - 18 = 12.
    expect(within(summary).getByText('$12.00')).toBeTruthy();
    // Savings figure.
    expect(within(summary).getByText('$18.00')).toBeTruthy();
  });

  it('updates the projected total when a row is toggled', () => {
    render(<CostPanel plan={plan} onApply={() => {}} />);
    const summary = screen.getByRole('region', { name: 'Cost plan summary' });
    // Toggle the budget row ON (savings 10): projected 12 - 10 = 2.
    fireEvent.click(screen.getByLabelText(/Swap Mana Crypt/));
    expect(within(summary).getByText('$2.00')).toBeTruthy();
  });

  it('fires onApply with the right {removeName, addName} pairs', () => {
    const onApply = vi.fn();
    render(<CostPanel plan={plan} onApply={onApply} />);
    // Turn off the sidegrade row, leaving the two drop-ins checked.
    fireEvent.click(screen.getByLabelText(/Swap Cyclonic Rift/));
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    expect(onApply).toHaveBeenCalledWith([
      { removeName: 'Sol Ring', addName: 'Sol Ring-alt' },
      { removeName: 'Gaea Cradle', addName: 'Gaea Cradle-alt' },
    ]);
  });

  it('disables Apply when nothing is selected', () => {
    render(<CostPanel plan={plan} onApply={() => {}} />);
    // Deselect the three default-checked rows.
    fireEvent.click(screen.getByLabelText(/Swap Sol Ring/));
    fireEvent.click(screen.getByLabelText(/Swap Cyclonic Rift/));
    fireEvent.click(screen.getByLabelText(/Swap Gaea Cradle/));
    const apply = screen.getByRole('button', { name: /Apply/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('auto-selects rows down to a budget target', () => {
    render(<CostPanel plan={plan} onApply={() => {}} />);
    const summary = screen.getByRole('region', { name: 'Cost plan summary' });
    fireEvent.change(screen.getByLabelText('Budget target in dollars'), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Auto-select to target' }));
    // Greedy over enabled tiers (drop-in + sidegrade): drop-in Sol Ring(8) → 22,
    // drop-in Gaea Cradle(4) → 18 ≤ 20. Projected total 18.
    expect(within(summary).getByText('$18.00')).toBeTruthy();
  });

  it('disables Apply while applying', () => {
    render(<CostPanel plan={plan} applying onApply={() => {}} />);
    const apply = screen.getByRole('button', { name: /Apply/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(screen.getByText('Applying…')).toBeTruthy();
  });
});
