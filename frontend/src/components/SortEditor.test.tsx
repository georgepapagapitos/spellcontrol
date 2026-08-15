// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SortEditor } from './SortEditor';
import type { SortEntry } from '../types';

function setup(sorts: SortEntry[]) {
  const onSortsChange = vi.fn();
  render(
    <SortEditor
      compact
      sorts={sorts}
      valueOrders={{}}
      onSortsChange={onSortsChange}
      onValueOrdersChange={vi.fn()}
    />
  );
  return { onSortsChange };
}

describe('SortEditor — direction', () => {
  // The whole point of this control: flipping used to require opening the field
  // dropdown and re-picking the field you already had.
  it('exposes direction as its own button, labelled with what it does', () => {
    setup([{ field: 'setReleaseDate', dir: 'desc' }]);
    // Not "desc" — ascending release date is newest-LAST, so the raw word is
    // ambiguous even when you know what it means.
    expect(screen.getByRole('button', { name: /direction: Newest first/i })).toBeTruthy();
  });

  it('reverses the direction of only its own row', () => {
    const { onSortsChange } = setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /^Sort 2 direction/i }));
    expect(onSortsChange).toHaveBeenCalledWith([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'desc' },
    ]);
  });

  it('labels each field in its own vocabulary', () => {
    setup([
      { field: 'name', dir: 'asc' },
      { field: 'edhrec', dir: 'asc' },
      { field: 'price', dir: 'desc' },
    ]);
    expect(screen.getByRole('button', { name: /direction: A → Z/i })).toBeTruthy();
    // Rank 1 is the most-played card, so ascending rank is the popular end.
    expect(screen.getByRole('button', { name: /direction: Most played/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /direction: Priciest/i })).toBeTruthy();
  });
});

describe('SortEditor — the chain', () => {
  it('does not offer a field another row already uses', () => {
    setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Sort 1 field' }));
    const offered = screen.getAllByRole('option').map((o) => o.textContent);
    // Its own field stays (it is the current selection); the other row's is gone.
    // Sorting by one field twice has no ties left to break on the second pass.
    expect(offered).toContain('Color');
    expect(offered).not.toContain('Name');
  });

  it('names the row it moves, so the reorder buttons are not two bare arrows', () => {
    setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
    expect(screen.getByRole('button', { name: 'Move Color later in the sort order' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove the Name sort' })).toBeTruthy();
  });

  it('reorders without touching directions', () => {
    const { onSortsChange } = setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'desc' },
    ]);
    // Row 1's "move earlier" is correctly disabled, so drive row 2's.
    fireEvent.click(screen.getByRole('button', { name: 'Move Name earlier in the sort order' }));
    expect(onSortsChange).toHaveBeenCalledWith([
      { field: 'name', dir: 'desc' },
      { field: 'color', dir: 'asc' },
    ]);
  });

  it('keeps the last sort undeletable and says why', () => {
    setup([{ field: 'color', dir: 'asc' }]);
    const remove = screen.getByRole('button', { name: /Remove the .* sort/i });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    expect(remove.getAttribute('title')).toMatch(/at least one sort/i);
  });
});
