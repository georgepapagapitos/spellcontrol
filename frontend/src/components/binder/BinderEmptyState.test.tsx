// @vitest-environment happy-dom
/**
 * A binder whose cards a search hides all of said "No cards match this
 * binder's rules" and offered Binder rules: the wrong cause and the wrong fix.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  search: '',
  setSearch: vi.fn(),
  setEditingBinder: vi.fn(),
}));
vi.mock('@/store/collection', () => ({
  useCollectionStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

import { BinderEmptyState } from './BinderEmptyState';

afterEach(() => {
  cleanup();
  store.search = '';
  vi.clearAllMocks();
});

describe('BinderEmptyState', () => {
  it('blames the search, and clears it, when the search hides every card', () => {
    store.search = 'counterspell';
    render(<BinderEmptyState binderId="b1" holdsCards />);
    expect(screen.getByText('No cards match your search.')).toBeTruthy();
    expect(screen.queryByText(/binder's rules/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(store.setSearch).toHaveBeenCalledWith('');
  });

  it('points at the rules when the binder holds nothing at all', () => {
    store.search = 'counterspell';
    render(<BinderEmptyState binderId="b1" holdsCards={false} />);
    expect(screen.getByText("No cards match this binder's rules.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Binder rules' }));
    expect(store.setEditingBinder).toHaveBeenCalledWith('b1');
  });

  it('points at the rules with no search', () => {
    render(<BinderEmptyState binderId="b1" holdsCards />);
    expect(screen.getByText("No cards match this binder's rules.")).toBeTruthy();
  });
});
