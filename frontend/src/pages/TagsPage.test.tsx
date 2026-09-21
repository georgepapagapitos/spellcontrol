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
    // A corpus tag with no description anywhere (not curated, none from Scryfall).
    { slug: 'typal', count: 4102 },
  ],
  cardTagLabel: (tag: string) =>
    tag === 'mana-rock' ? 'Mana rock' : tag === 'typal' ? 'Typal' : 'Removal',
  cardTagDescription: () => '',
  cardTagsGeneratedAt: () => '2026-09-01T15:12:06.395Z',
  // The corpus knows its three tags plus one legacy alias — aliases are absent
  // from the ranked list on purpose but must still resolve from a URL.
  isKnownCardTag: (slug: string) =>
    ['removal', 'mana-rock', 'typal', 'boardwipe'].includes(slug),
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

  it("never prints a row's label as its own description, and dates the counts (playtest batch 10)", () => {
    renderPage();
    // "Typal · 4,102 cards" and nothing more — not "Typal · 4,102 cards · Typal".
    const row = screen.getByRole('button', { name: /Typal/ });
    expect(row.textContent).toBe('Typal4,102 cards');
    expect(row.querySelector('.tags-row-desc')).toBeNull();
    // The count is the snapshot's, and the page says so.
    expect(
      screen.getByText(/Card counts are from Scryfall's tag data as of Sep 1, 2026\./)
    ).toBeTruthy();
  });

  it("collapses the browser on the first pick so results aren't pushed off-screen", () => {
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
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load the tag list.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(ensureCardTags).toHaveBeenCalledTimes(1);
  });

  // ── board E340 — a `?t=` slug the corpus doesn't know ────────────────────
  it("says there's no such tag instead of inventing a chip and a title", () => {
    renderPage('/tags?t=not-a-real-tag-xyz');
    // The defect: `parseTagParam` vets only the character class, so the page
    // rendered the chip "Not a real tag xyz", titled the results with it, and
    // searched `otag:not-a-real-tag-xyz`.
    expect(screen.getByText(/There's no tag called “not-a-real-tag-xyz”\./)).toBeTruthy();
    expect(screen.queryByText('Not a real tag xyz')).toBeNull();
    expect(screen.queryByTestId('results')).toBeNull();
    expect(searchQueries).toEqual([]);
    // And the generic invitation doesn't pile on under the note.
    expect(screen.queryByText('Pick a tag to see what it finds.')).toBeNull();
  });

  it('keeps the real tags in a mixed selection and names only the junk', () => {
    renderPage('/tags?t=removal,not-a-tag');
    expect(screen.getByTestId('results').textContent).toBe('otag:removal');
    expect(screen.getByText(/There's no tag called “not-a-tag”\./)).toBeTruthy();
    // The chip row is the real tag only.
    expect(screen.getByRole('button', { name: /Remove Removal from the selection/ })).toBeTruthy();
  });

  it('resolves a legacy alias from a URL even though the list never offers it', () => {
    // LEGACY_TAG_ALIASES slugs are excluded from the ranked list (they are
    // match compatibility, not browsable concepts) — validating against that
    // list alone would break a link someone saved.
    renderPage('/tags?t=boardwipe');
    expect(screen.getByTestId('results').textContent).toBe('otag:boardwipe');
    expect(screen.queryByText(/There's no tag called/)).toBeNull();
  });

  it('says nothing about unknown slugs until the corpus has loaded', () => {
    // Before the snapshot lands every slug reads unknown; flashing the note at
    // a real deep link would be a worse lie than the one being fixed.
    readyRef.value = false;
    renderPage('/tags?t=removal');
    expect(screen.queryByText(/There's no tag called/)).toBeNull();
  });
});
