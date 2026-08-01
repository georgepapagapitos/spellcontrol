// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagsPage } from './TagsPage';

// Isolate from the snapshot fetch (public/otag-index.json is a regenerated
// asset tests may not read) and from the network-backed results panel.
const readyRef = { value: true };
const errorRef = { value: false };
const ensureCardTags = vi.fn();
vi.mock('../lib/card-tags', () => ({
  useCardTagsReady: () => readyRef.value,
  useCardTagsError: () => errorRef.value,
  ensureCardTags: () => ensureCardTags(),
  listCardTagsRanked: () => [
    { slug: 'removal', count: 6258 },
    { slug: 'mana-rock', count: 369 },
  ],
  cardTagLabel: (tag: string) => (tag === 'mana-rock' ? 'Mana rock' : 'Removal'),
  cardTagDescription: () => '',
}));

const searchQueries: string[] = [];
vi.mock('../components/InlineCardSearch', () => ({
  InlineCardSearch: ({ query }: { query: string }) => {
    searchQueries.push(query);
    return <div data-testid="results">{query}</div>;
  },
}));

afterEach(() => {
  readyRef.value = true;
  errorRef.value = false;
  ensureCardTags.mockClear();
  searchQueries.length = 0;
});

const renderPage = (path = '/tags') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TagsPage />
    </MemoryRouter>
  );

describe('TagsPage', () => {
  it('lists tags with card counts and no results until one is picked', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Removal/ }).textContent).toContain('6,258 cards');
    expect(screen.queryByTestId('results')).toBeNull();
    expect(screen.getByText('Pick a tag to see what it finds.')).toBeTruthy();
  });

  it('collapses the browser on the first pick so results aren’t pushed off-screen', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Removal/ }));
    expect(screen.getByTestId('results').textContent).toBe('otag:removal');
    // The 120-row grid is gone; only the disclosure remains.
    expect(screen.queryByRole('button', { name: /6,258 cards/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add another tag' })).toBeTruthy();
  });

  it('reopens the browser to intersect a second tag', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Removal/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add another tag' }));
    fireEvent.click(screen.getByRole('button', { name: /Mana rock/ }));
    expect(screen.getByTestId('results').textContent).toBe('otag:removal otag:mana-rock');
    // Stays open for a third pick — only the first selection collapses it.
    expect(screen.getByRole('button', { name: 'Hide tags' })).toBeTruthy();
  });

  it('restores the browser when the last tag is cleared', () => {
    renderPage('/tags?t=removal');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByRole('button', { name: /6,258 cards/ })).toBeTruthy();
    expect(screen.queryByTestId('results')).toBeNull();
  });

  it('restores a selection from the ?t= param, browser collapsed', () => {
    renderPage('/tags?t=mana-rock');
    expect(screen.getByTestId('results').textContent).toBe('otag:mana-rock');
    expect(screen.queryByRole('button', { name: /369 cards/ })).toBeNull();
  });

  it('reopens the browser when the user types, without needing the disclosure', () => {
    renderPage('/tags?t=removal');
    fireEvent.change(screen.getByLabelText('Search card tags'), { target: { value: 'rock' } });
    expect(screen.getByRole('button', { name: /369 cards/ })).toBeTruthy();
  });

  it('filters the tag list and shows a no-match empty state', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search card tags'), { target: { value: 'rock' } });
    expect(screen.queryByRole('button', { name: /6,258 cards/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search card tags'), { target: { value: 'zzz' } });
    expect(screen.getByText('No tag matches “zzz”.')).toBeTruthy();
  });

  it('shows a loading state until the snapshot is ready', () => {
    readyRef.value = false;
    renderPage();
    expect(screen.getByRole('status').textContent).toContain('Loading tags…');
  });

  it('shows an error with retry when the snapshot fetch failed', () => {
    readyRef.value = false;
    errorRef.value = true;
    renderPage();
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t load the tag list.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(ensureCardTags).toHaveBeenCalledTimes(1);
  });
});
