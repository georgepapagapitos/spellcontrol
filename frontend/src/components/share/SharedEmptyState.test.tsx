// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SharedEmptyState } from './SharedEmptyState';

describe('SharedEmptyState', () => {
  it('renders the genuine-empty branch with the brand mark and a reason, no Clear button', () => {
    render(
      <SharedEmptyState
        empty
        emptyTagline="This binder is empty."
        emptyHint="The owner hasn't added any cards to it yet."
        filteredTagline="No cards match your search or filters."
      />
    );
    expect(screen.getByText('This binder is empty.')).toBeTruthy();
    expect(screen.getByText("The owner hasn't added any cards to it yet.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset search' })).toBeNull();
  });

  it('renders the filtered branch with the Reset-search button when a handler is passed', () => {
    const onClearSearch = vi.fn();
    render(
      <SharedEmptyState
        empty={false}
        emptyTagline="This binder is empty."
        emptyHint="The owner hasn't added any cards to it yet."
        filteredTagline="No cards match your search or filters."
        onClearSearch={onClearSearch}
      />
    );
    expect(screen.getByText('No cards match your search or filters.')).toBeTruthy();
    expect(screen.queryByText('This binder is empty.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset search' }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it('omits the Reset-search button when the search box is already empty', () => {
    render(
      <SharedEmptyState
        empty={false}
        emptyTagline="This binder is empty."
        emptyHint="The owner hasn't added any cards to it yet."
        filteredTagline="No cards match your search or filters."
      />
    );
    expect(screen.queryByRole('button', { name: 'Reset search' })).toBeNull();
  });
});
