// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OptimizeCard, OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import { OptimizePanel } from './OptimizePanel';

function card(over: Partial<OptimizeCard> & { name: string }): OptimizeCard {
  return {
    reason: 'because',
    reasonCategory: 'low-inclusion',
    inclusion: 50,
    ...over,
  };
}

const swaps: OptimizeSwaps = {
  removals: [
    card({ name: 'Cut A', reasonCategory: 'low-synergy', inclusion: 12 }),
    card({ name: 'Cut B', reasonCategory: 'tapland', inclusion: 4 }),
  ],
  additions: [
    card({ name: 'Add A', reasonCategory: 'fills:removal', inclusion: 70 }),
    card({ name: 'Add B', reasonCategory: 'fills:ramp', inclusion: 55 }),
  ],
};

describe('OptimizePanel', () => {
  it('renders humanized group sections for both columns', () => {
    render(<OptimizePanel swaps={swaps} currentSize={100} onApply={() => {}} />);
    expect(screen.getByText('Low Synergy')).toBeTruthy();
    expect(screen.getByText('Taplands')).toBeTruthy();
    expect(screen.getByText('Fills Removal Gap')).toBeTruthy();
    expect(screen.getByText('Fills Ramp Gap')).toBeTruthy();
  });

  it('shows an empty state when there are no swaps', () => {
    render(
      <OptimizePanel swaps={{ removals: [], additions: [] }} currentSize={100} onApply={() => {}} />
    );
    expect(screen.getByText(/Looks optimized/)).toBeTruthy();
  });

  it('marks owned additions with a badge', () => {
    render(
      <OptimizePanel
        swaps={swaps}
        currentSize={100}
        ownedNames={new Set(['Add A'])}
        onApply={() => {}}
      />
    );
    expect(screen.getAllByText('Owned').length).toBe(1);
  });

  it('updates the apply summary when a tile is toggled off', () => {
    render(<OptimizePanel swaps={swaps} currentSize={100} onApply={() => {}} />);
    const summary = screen.getByRole('region', { name: 'Plan summary' });
    // Default: 2 cuts + 2 adds, projected size unchanged at 100.
    expect(within(summary).getByLabelText(/projected deck size 100/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Keep Cut A (cancel removal)'));
    // Apply aria-label reflects the new count.
    expect(
      screen.getByLabelText(/Apply 1 cut and 2 additions, projected deck size 101/)
    ).toBeTruthy();
  });

  it('fires onApply with the checked names', () => {
    const onApply = vi.fn();
    render(<OptimizePanel swaps={swaps} currentSize={100} onApply={onApply} />);
    fireEvent.click(screen.getByLabelText('Skip Add B (cancel addition)'));
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    expect(onApply).toHaveBeenCalledWith(['Cut A', 'Cut B'], ['Add A']);
  });

  it('disables Apply when nothing is selected', () => {
    render(<OptimizePanel swaps={swaps} currentSize={100} onApply={() => {}} />);
    // Deselect every removal and addition via the column toggles.
    fireEvent.click(screen.getByLabelText('Deselect all in Remove suggestions'));
    fireEvent.click(screen.getByLabelText('Deselect all in Add suggestions'));
    const apply = screen.getByRole('button', { name: /Apply/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('disables Apply while applying', () => {
    render(<OptimizePanel swaps={swaps} currentSize={100} applying onApply={() => {}} />);
    const apply = screen.getByRole('button', { name: /Apply/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(screen.getByText('Applying…')).toBeTruthy();
  });

  it('"Owned upgrades only" filters the Add column to owned cards', () => {
    const onApply = vi.fn();
    render(
      <OptimizePanel
        swaps={swaps}
        currentSize={100}
        ownedNames={new Set(['Add A'])}
        onApply={onApply}
      />
    );
    // Both additions visible by default.
    expect(screen.getByText('Add A')).toBeTruthy();
    expect(screen.getByText('Add B')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Owned upgrades only'));

    // Only the owned addition remains; cuts are untouched.
    expect(screen.getByText('Add A')).toBeTruthy();
    expect(screen.queryByText('Add B')).toBeNull();
    // Apply now carries only the owned addition.
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    expect(onApply).toHaveBeenCalledWith(['Cut A', 'Cut B'], ['Add A']);
  });

  it('shows a hint when "Owned upgrades only" leaves no additions', () => {
    render(
      <OptimizePanel
        swaps={swaps}
        currentSize={100}
        ownedNames={new Set<string>()}
        onApply={() => {}}
      />
    );
    fireEvent.click(screen.getByLabelText('Owned upgrades only'));
    expect(screen.getByText(/No upgrades in your collection/)).toBeTruthy();
  });
});
