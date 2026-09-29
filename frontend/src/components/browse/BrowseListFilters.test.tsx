// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BROWSE_FILTERS,
  browseListDef,
  type BrowseFilters,
} from '@/lib/discover/browse-lists';
import { BrowseListFilters } from './BrowseListFilters';

function stubPhone(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && /max-width:\s*599px/.test(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function renderFilters(
  list: string,
  filters: BrowseFilters = DEFAULT_BROWSE_FILTERS,
  ownedFilter = true
) {
  const onChange = vi.fn();
  render(
    <BrowseListFilters
      def={browseListDef(list)!}
      filters={filters}
      ownedFilter={ownedFilter}
      onChange={onChange}
    />
  );
  return onChange;
}

afterEach(() => vi.unstubAllGlobals());

describe('BrowseListFilters, wider than a phone', () => {
  it('keeps every filter in the row', () => {
    stubPhone(false);
    renderFilters('cards');
    expect(screen.getByRole('group', { name: 'Time period' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Color identity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Type/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'In my collection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
  });

  it('shows nothing for a list with no filters and no collection', () => {
    stubPhone(false);
    renderFilters('banned', DEFAULT_BROWSE_FILTERS, false);
    expect(document.querySelector('.browse-list-filters')).toBeNull();
  });
});

describe('BrowseListFilters on a phone', () => {
  it('keeps the period in the row and folds the rest into Filters', () => {
    stubPhone(true);
    const onChange = renderFilters('cards');

    expect(screen.getByRole('group', { name: 'Time period' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Color identity' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(panel).getByRole('group', { name: 'Color identity' })).toBeTruthy();

    fireEvent.click(within(panel).getByRole('radio', { name: 'Mana rocks' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_BROWSE_FILTERS,
      type: 'mana-artifacts',
    });

    fireEvent.click(within(panel).getByRole('button', { name: 'Blue' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSE_FILTERS, colors: 'U' });

    fireEvent.click(within(panel).getByRole('radio', { name: 'In my collection' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSE_FILTERS, ownedOnly: true });
  });

  it('counts the filters that are on and clears them in one go', () => {
    stubPhone(true);
    const on: BrowseFilters = { period: 'month', colors: 'WU', type: 'lands', ownedOnly: true };
    const onChange = renderFilters('cards', on);

    const trigger = screen.getByRole('button', { name: 'Filters (3 active)' });
    expect(trigger.textContent).toContain('Filters · 3');
    expect(screen.getByText('Color and type lists cover the past 2 years.')).toBeTruthy();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...on, colors: '', type: '', ownedOnly: false });
  });

  it('keeps a lone owned toggle in the row, with nothing to fold', () => {
    stubPhone(true);
    renderFilters('salt');
    expect(screen.getByRole('radio', { name: 'In my collection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
  });
});
