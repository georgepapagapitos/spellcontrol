// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resultCountLabel } from '@/lib/search/result-count-label';
import { FilterPopoverFooter } from './FilterPopoverFooter';

describe('resultCountLabel', () => {
  it('counts, singularizes, and says when nothing matches', () => {
    expect(resultCountLabel(14, 'deck')).toBe('14 decks');
    expect(resultCountLabel(1, 'deck')).toBe('1 deck');
    expect(resultCountLabel(0, 'combo')).toBe('No combos match');
    expect(resultCountLabel(1200, 'combo')).toBe('1,200 combos');
  });
  it('marks a count that is only the loaded pages', () => {
    expect(resultCountLabel(24, 'deck', true)).toBe('24+ decks');
    expect(resultCountLabel(1, 'deck', true)).toBe('1+ decks');
  });
});

describe('FilterPopoverFooter', () => {
  it('renders the count and a Clear filters button only when asked', () => {
    const onClear = vi.fn();
    const { rerender, container } = render(<FilterPopoverFooter resultLabel="3 decks" />);
    expect(screen.getByText('3 decks').getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<FilterPopoverFooter resultLabel="3 decks" onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
    rerender(<FilterPopoverFooter />);
    expect(container.firstChild).toBeNull();
  });
});
