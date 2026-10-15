// @vitest-environment happy-dom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptyComboFilters, type ComboFilterState } from '@/lib/deck-analysis/combo-filters';
import { ComboFiltersPopover } from './ComboFiltersPopover';

function Harness({ hasCommanders = true }: { hasCommanders?: boolean }) {
  const [filters, setFilters] = useState<ComboFilterState>(emptyComboFilters);
  return (
    <>
      <ComboFiltersPopover
        filters={filters}
        setFilters={setFilters}
        hasCommanders={hasCommanders}
        resultLabel="9 combos"
      />
      <output data-testid="state">
        {JSON.stringify({
          c: [...filters.colors],
          m: filters.colorMode,
          r: [...filters.results],
          p: [...filters.pieceCounts],
          h: filters.hostOnly,
        })}
      </output>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}');
const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));

describe('ComboFiltersPopover', () => {
  it('defaults the color mode to Within and offers the other two', () => {
    render(<Harness />);
    openPanel();
    expect((screen.getByRole('radio', { name: 'Within these' }) as HTMLInputElement).checked).toBe(
      true
    );
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(state()).toMatchObject({ c: ['U'], m: 'within' });
    expect(
      screen.getByText('Combos that fit a blue deck. Colorless combos included.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Exactly these' }));
    expect(state().m).toBe('all');
  });

  it('toggles Result and Pieces chips and the host chip', () => {
    render(<Harness />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Mana' }));
    fireEvent.click(screen.getByRole('button', { name: '4+ cards' }));
    fireEvent.click(screen.getByRole('button', { name: 'One of mine can host it' }));
    expect(state()).toMatchObject({ r: ['mana'], p: ['4+'], h: true });
  });

  it('disables the host chip with no commanders', () => {
    render(<Harness hasCommanders={false} />);
    openPanel();
    expect(
      (screen.getByRole('button', { name: 'One of mine can host it' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('shows the live count and clears everything', () => {
    render(<Harness />);
    openPanel();
    expect(screen.getByText('9 combos')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(state()).toMatchObject({ r: [], c: [], h: false });
  });
});
