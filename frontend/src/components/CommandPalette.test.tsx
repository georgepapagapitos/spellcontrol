// @vitest-environment happy-dom
// E247 — the palette's two async lanes: the Cards group (debounced Scryfall
// search with loading/error/empty states) and the self-hiding AI group.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';

// The search hook is the app's shared debounce/loading/error machinery — its
// own tests cover the timing. Here it's a dial the palette reads.
const searchState: { results: ScryfallCard[]; loading: boolean; error: string | null } = {
  results: [],
  loading: false,
  error: null,
};
vi.mock('../lib/use-search-cards', () => ({ useSearchCards: () => searchState }));

let aiState: { optIn: boolean; used: number; limit: number } | null = null;
vi.mock('../lib/use-ai-status', () => ({ useAiStatus: () => aiState }));

const opened: { entries: { name: string }[]; tapped: string }[] = [];
vi.mock('./deck/useCardCarousel', () => ({
  useCardCarousel: () => ({
    open: (entries: { name: string }[], tapped: string) => opened.push({ entries, tapped }),
    preview: null,
  }),
}));

// Modal brings the whole overlay stack; the palette only needs a container.
vi.mock('./Modal', () => ({
  Modal: ({
    children,
    label,
    className,
  }: {
    children: React.ReactNode;
    label: string;
    className?: string;
  }) => (
    <div role="dialog" aria-label={label} className={className}>
      {children}
    </div>
  ),
}));

const DECKS = [{ id: 'd1', name: 'Sac Value', cards: [], commander: null }];
vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: typeof DECKS }) => unknown) => sel({ decks: DECKS }),
}));

import { CommandPalette } from './CommandPalette';

function card(id: string, name: string, typeLine?: string): ScryfallCard {
  return { id, name, type_line: typeLine } as ScryfallCard;
}

function renderPalette(path = '/home') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CommandPalette onClose={() => {}} />
    </MemoryRouter>
  );
}

function type(query: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } });
}

beforeEach(() => {
  searchState.results = [];
  searchState.loading = false;
  searchState.error = null;
  aiState = null;
  opened.length = 0;
});

describe('the Cards lane', () => {
  it('renders results as a group and opens the carousel without closing the palette', () => {
    searchState.results = [card('c1', 'Sol Ring', 'Artifact'), card('c2', 'Solemn Simulacrum')];
    renderPalette();
    type('sol');

    expect(screen.getByText('Cards')).toBeTruthy();
    const row = screen.getByRole('option', { name: /Sol Ring/ });
    expect(row.textContent).toContain('Artifact');

    fireEvent.click(row);
    // Both results become swipeable entries, focused on the tapped one…
    expect(opened[0].tapped).toBe('Sol Ring');
    expect(opened[0].entries.map((e) => e.name)).toEqual(['Sol Ring', 'Solemn Simulacrum']);
    // …and the palette stays open underneath for the next preview.
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('shows a searching line while loading and the error when the search fails', () => {
    searchState.loading = true;
    renderPalette();
    type('sol');
    expect(screen.getByRole('status').textContent).toBe('Searching cards…');

    searchState.loading = false;
    searchState.error = 'Card search failed.';
    type('sol r');
    expect(screen.getByRole('status').textContent).toBe('Card search failed.');
  });

  it('keeps the lane closed under the 2-character floor, even with stale results', () => {
    searchState.results = [card('c1', 'Sol Ring')];
    renderPalette();
    type('s');
    expect(screen.queryByText('Cards')).toBeNull();
  });

  it('falls through to the shared empty state when nothing matches anywhere', () => {
    renderPalette();
    type('zzzzzz');
    expect(screen.getByText(/No matches for/).textContent).toContain('zzzzzz');
  });
});

describe('the AI group', () => {
  it('is absent entirely while the feature is unavailable', () => {
    renderPalette('/decks/d1');
    type('ai');
    expect(screen.queryByText('AI')).toBeNull();
    expect(screen.queryByRole('option', { name: /Read the deck/ })).toBeNull();
  });

  it('offers AI settings anywhere, and Read the deck only on a real deck page', () => {
    aiState = { optIn: true, used: 0, limit: 10 };
    renderPalette();
    type('ai');
    expect(screen.getByRole('option', { name: /AI settings/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Read the deck/ })).toBeNull();
  });

  it('scopes Read the deck to the open deck, named in the hint', () => {
    aiState = { optIn: true, used: 0, limit: 10 };
    renderPalette('/decks/d1');
    type('read');
    const row = screen.getByRole('option', { name: /Read the deck/ });
    expect(row.textContent).toContain('Sac Value');
  });

  it('does not offer Read the deck on /decks/new — the pattern matches, no deck does', () => {
    aiState = { optIn: true, used: 0, limit: 10 };
    renderPalette('/decks/new');
    type('read');
    expect(screen.queryByRole('option', { name: /Read the deck/ })).toBeNull();
  });
});
