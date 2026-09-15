// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../store/decks', () => ({
  useDecksStore: vi.fn(),
}));
vi.mock('../lib/deck-diff', () => ({
  diffDecks: vi.fn(),
}));
vi.mock('../lib/use-tagger-ready', () => ({ useTaggerReady: () => false }));
vi.mock('../lib/build-mana-data', () => ({
  buildManaData: vi.fn(() => ({
    manaCurve: {},
    averageCmc: 0,
    colorDist: { counts: {}, total: 0 },
    manaProduction: { counts: {}, total: 0, sourcesByColor: {} },
    typeBreakdown: {},
    cardsByCmc: {},
    cardsByType: {},
    cardsByColor: {},
  })),
}));

import { DeckComparePage } from './DeckComparePage';
import { useDecksStore } from '../store/decks';
import { diffDecks } from '../lib/deck-diff';

const mockUseDecksStore = useDecksStore as unknown as ReturnType<typeof vi.fn>;
const mockDiffDecks = diffDecks as unknown as ReturnType<typeof vi.fn>;

const deckA = {
  id: 'a',
  name: 'Deck A',
  commander: null,
  partnerCommander: null,
  cards: [],
  sideboard: [],
  format: 'commander',
  source: 'manual',
  color: '#fff',
  createdAt: 0,
  updatedAt: 0,
  commanderAllocatedCopyId: null,
  partnerCommanderAllocatedCopyId: null,
  generationContext: null,
};
const deckB = { ...deckA, id: 'b', name: 'Deck B' };

const emptyDiff = {
  cards: { added: [], removed: [], changed: [], unchangedCount: 5 },
  stats: {
    size: { a: 10, b: 10, delta: 0 },
    curve: { averageCmc: { a: 2.5, b: 2.5, delta: 0 }, buckets: [] },
    types: {
      creatures: { a: 0, b: 0, delta: 0 },
      instants: { a: 0, b: 0, delta: 0 },
      sorceries: { a: 0, b: 0, delta: 0 },
      artifacts: { a: 0, b: 0, delta: 0 },
      enchantments: { a: 0, b: 0, delta: 0 },
      planeswalkers: { a: 0, b: 0, delta: 0 },
      battles: { a: 0, b: 0, delta: 0 },
      lands: { a: 0, b: 0, delta: 0 },
      other: { a: 0, b: 0, delta: 0 },
    },
    roles: [],
    colors: {
      W: { a: 0, b: 0, delta: 0 },
      U: { a: 0, b: 0, delta: 0 },
      B: { a: 0, b: 0, delta: 0 },
      R: { a: 0, b: 0, delta: 0 },
      G: { a: 0, b: 0, delta: 0 },
      C: { a: 0, b: 0, delta: 0 },
    },
    taggerReady: false,
  },
  price: { aTotal: 10, bTotal: 12, delta: 2 },
  bracket: {
    a: { bracket: undefined, gradeLetter: undefined },
    b: { bracket: undefined, gradeLetter: undefined },
  },
};

const cardDelta = (i: number) => ({
  card: {
    id: `c${i}`,
    oracle_id: `o${i}`,
    name: `Card ${i}`,
    cmc: 1,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    legalities: { commander: 'legal' },
    prices: {},
  },
  isCommander: false,
  fromQty: 0,
  toQty: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDecksStore.mockImplementation(
    (sel: (s: { decks: (typeof deckA)[]; hydrated: boolean }) => unknown) =>
      sel({ decks: [deckA, deckB], hydrated: true })
  );
  mockDiffDecks.mockReturnValue(emptyDiff);
});

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/decks/compare${search}`]}>
      <DeckComparePage />
    </MemoryRouter>
  );
}

describe('DeckComparePage', () => {
  it('shows empty state when no URL params', () => {
    renderPage();
    expect(screen.getByText(/pick two decks to compare/i)).toBeTruthy();
  });

  it('renders picker row', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /deck a/i })).toBeTruthy();
  });

  it('does not render diff when only one deck selected', () => {
    renderPage('?a=a');
    expect(screen.queryByText(/in both decks/i)).toBeNull();
  });

  it('leads with how much of the two lists overlaps', () => {
    renderPage('?a=a&b=b');
    // 5 unchanged + 0 changed in both; nothing on either side alone.
    expect(screen.getByText(/run exactly the same cards/i)).toBeTruthy();
    expect(screen.getByText(/in both/i)).toBeTruthy();
  });

  it('names the deck each card-list group belongs to', () => {
    mockDiffDecks.mockReturnValue({
      ...emptyDiff,
      cards: { added: [cardDelta(0)], removed: [cardDelta(1)], changed: [], unchangedCount: 4 },
    });
    renderPage('?a=a&b=b');
    expect(screen.getByText(/only in Deck B \(1\)/i)).toBeTruthy();
    expect(screen.getByText(/only in Deck A \(1\)/i)).toBeTruthy();
  });

  it('heads every value column with the deck it belongs to', () => {
    renderPage('?a=a&b=b');
    // A number on this page is meaningless without the deck name above it.
    expect(screen.getAllByRole('columnheader', { name: 'Deck A' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: 'Deck B' }).length).toBeGreaterThan(0);
  });

  it('reads an unchanged stat as "same", never a signed zero', () => {
    renderPage('?a=a&b=b');
    // size 10 vs 10, avg 0 vs 0 — "−0.0" was the old rendering.
    expect(screen.queryByText(/−0(\.0)?$/)).toBeNull();
    expect(screen.getAllByText('same').length).toBeGreaterThan(0);
  });

  it('prefills pickers from URL params', () => {
    renderPage('?a=a&b=b');
    // Both deck names should appear in the picker triggers
    expect(screen.getAllByText('Deck A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deck B').length).toBeGreaterThan(0);
  });

  it('shows Show N more button when added list exceeds 8 and clicking expands', () => {
    const manyCards = Array.from({ length: 10 }, (_, i) => cardDelta(i));
    mockDiffDecks.mockReturnValue({
      ...emptyDiff,
      cards: { added: manyCards, removed: [], changed: [], unchangedCount: 0 },
    });
    renderPage('?a=a&b=b');
    const showMoreBtn = screen.getByRole('button', { name: /show 2 more/i });
    expect(showMoreBtn).toBeTruthy();
    fireEvent.click(showMoreBtn);
    expect(screen.getByRole('button', { name: /show fewer/i })).toBeTruthy();
  });
});
