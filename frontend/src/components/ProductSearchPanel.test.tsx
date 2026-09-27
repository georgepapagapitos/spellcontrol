// @vitest-environment happy-dom
/**
 * Products tab of the Add-cards sheet (T153). Covers the context-aware
 * primary action (collection-first vs deck-first), the quantity stepper
 * multiplying imported copies, the post-add routing summary, and the
 * Secret-Lair collection-only case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ProductResolveResponse, ProductSummary } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});

const searchProductsMock = vi.fn<(query: string, type?: string) => Promise<ProductSummary[]>>();
const fetchProductMock = vi.fn<(fileName: string) => Promise<ProductResolveResponse>>();
vi.mock('../lib/api', () => ({
  searchProducts: (query: string, type?: string) => searchProductsMock(query, type),
  fetchProduct: (fileName: string) => fetchProductMock(fileName),
  useSetMap: () => undefined,
  fetchProductCommanderSummary: vi.fn(async () => null),
}));

const buildDeckMock = vi.fn(() => 'new-deck-id');
vi.mock('../lib/build-deck-from-import', () => ({
  useBuildDeckFromImport: () => buildDeckMock,
}));

const importCardsMock =
  vi.fn<(upload: { cards: unknown[] }, label: string, mode: string) => Promise<string>>();
vi.mock('../store/collection', () => ({
  useCollectionStore: Object.assign(
    (
      selector: (s: {
        cards: unknown[];
        binders: unknown[];
        importCards: typeof importCardsMock;
      }) => unknown
    ) => selector({ cards: [], binders: [], importCards: importCardsMock }),
    { getState: () => ({ cards: [] }) }
  ),
}));

import { ProductSearchPanel } from './ProductSearchPanel';

function makeScryfallCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'card-1',
    oracle_id: 'oracle-1',
    name: 'Test Commander',
    cmc: 3,
    type_line: 'Legendary Creature — Test',
    color_identity: ['U'],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    prices: { usd: '1.00' },
    legalities: { commander: 'legal' },
    image_uris: {
      small: '',
      normal: 'https://example.test/card.jpg',
      large: '',
      png: '',
      art_crop: '',
      border_crop: '',
    },
    ...overrides,
  } as ScryfallCard;
}

const PRODUCT_SUMMARY: ProductSummary = {
  fileName: 'test-precon',
  code: 'TST',
  name: 'Test Precon',
  type: 'Commander Deck',
  releaseDate: '2024-01-01',
};

const SLD_SUMMARY: ProductSummary = {
  fileName: 'test-sld',
  code: 'SLD',
  name: 'Test Drop',
  type: 'Secret Lair Drop',
  releaseDate: '2024-01-01',
};

function makeResolved(overrides: Partial<ProductResolveResponse> = {}): ProductResolveResponse {
  const commander = makeScryfallCard();
  const other = makeScryfallCard({ id: 'card-2', oracle_id: 'oracle-2', name: 'Test Other' });
  return {
    product: PRODUCT_SUMMARY,
    deck: {
      commander,
      partner: null,
      companion: null,
      cards: [commander, other],
      unresolvedNames: [],
      fetchErrors: [],
      detectedFormat: 'commander',
      cardCount: 2,
    },
    physicalCards: [
      { card: commander, quantity: 1, finish: 'nonfoil', zone: 'commander' },
      { card: other, quantity: 1, finish: 'nonfoil', zone: 'mainBoard' },
    ],
    unresolvedNames: [],
    fetchErrors: [],
    physicalCardCount: 2,
    ...overrides,
  };
}

function makeSldResolved(): ProductResolveResponse {
  const card = makeScryfallCard({ id: 'sld-1', oracle_id: 'oracle-sld', name: 'Drop Card' });
  return {
    product: SLD_SUMMARY,
    deck: {
      commander: null,
      partner: null,
      companion: null,
      cards: [],
      unresolvedNames: [],
      fetchErrors: [],
      detectedFormat: 'mtgjson',
      cardCount: 0,
    },
    physicalCards: [{ card, quantity: 1, finish: 'nonfoil', zone: 'mainBoard' }],
    unresolvedNames: [],
    fetchErrors: [],
    physicalCardCount: 1,
  };
}

async function openProductDetail(name = 'Test Precon') {
  await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
  fireEvent.click(screen.getByText(name));
  await waitFor(() => expect(screen.getByText('Back to search')).toBeTruthy());
}

beforeEach(() => {
  navigateMock.mockReset();
  searchProductsMock.mockReset().mockResolvedValue([PRODUCT_SUMMARY]);
  fetchProductMock.mockReset().mockResolvedValue(makeResolved());
  buildDeckMock.mockReset().mockReturnValue('new-deck-id');
  importCardsMock.mockReset().mockResolvedValue('import-1');
});

function renderPanel(props: Partial<React.ComponentProps<typeof ProductSearchPanel>> = {}) {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <ProductSearchPanel onClose={onClose} {...props} />
    </MemoryRouter>
  );
  return { onClose };
}

describe('ProductSearchPanel — collection context (default)', () => {
  it('shows one primary "Add N cards to collection" and the deck switch, never "Add both"', async () => {
    renderPanel();
    await openProductDetail();

    expect(screen.getByRole('button', { name: /Add 2 cards to collection/ })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Also build it as a deck' })).toBeTruthy();
    expect(screen.queryByText('Add both')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add as deck' })).toBeNull();
  });

  it('adds to the collection and shows the routing summary, without building a deck', async () => {
    renderPanel();
    await openProductDetail();

    fireEvent.click(screen.getByRole('button', { name: /Add 2 cards to collection/ }));

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(buildDeckMock).not.toHaveBeenCalled();
    const [upload, label, mode] = importCardsMock.mock.calls[0];
    expect(upload.cards).toHaveLength(2);
    expect(label).toBe('product-import:Test Precon');
    expect(mode).toBe('merge');

    await waitFor(() =>
      expect(screen.getByText(/Added 2 cards from Test Precon to your collection\./)).toBeTruthy()
    );
    expect(screen.queryByRole('button', { name: 'Open deck' })).toBeNull();
  });

  it('quantity multiplies the imported copies and the primary label', async () => {
    renderPanel();
    await openProductDetail();

    fireEvent.click(screen.getByRole('button', { name: 'One more copy' }));
    expect(screen.getByRole('button', { name: 'Add 4 cards to collection' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add 4 cards to collection' }));
    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    const [upload] = importCardsMock.mock.calls[0];
    expect(upload.cards).toHaveLength(4);
  });

  it('the deck switch also builds the deck, after the collection import, and offers Open deck', async () => {
    renderPanel();
    await openProductDetail();

    fireEvent.click(screen.getByRole('switch', { name: 'Also build it as a deck' }));
    fireEvent.click(screen.getByRole('button', { name: /Add 2 cards to collection/ }));

    await waitFor(() => expect(buildDeckMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock).toHaveBeenCalledTimes(1);
    // Collection import happens before the deck is built, so the deck can
    // allocate against the copies just added (T17 ordering).
    const importOrder = importCardsMock.mock.invocationCallOrder[0];
    const buildOrder = buildDeckMock.mock.invocationCallOrder[0];
    expect(importOrder).toBeLessThan(buildOrder);

    const openDeck = await screen.findByRole('button', { name: 'Open deck' });
    fireEvent.click(openDeck);
    expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id');
  });
});

describe('ProductSearchPanel — deck context', () => {
  it('keeps "Add as deck" primary, with the collection switch off by default and no quantity shown', async () => {
    renderPanel({ context: 'deck' });
    await openProductDetail();

    expect(screen.getByRole('button', { name: 'Add as deck' })).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Also add the cards to my collection' })
    ).toBeTruthy();
    expect(screen.queryByLabelText('Copies')).toBeNull();
    expect(screen.queryByText('Add both')).toBeNull();
  });

  it('"Add as deck" alone builds the deck and navigates, without touching the collection', async () => {
    renderPanel({ context: 'deck' });
    await openProductDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Add as deck' }));

    await waitFor(() => expect(buildDeckMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id');
  });

  it('switching on "also add to my collection" reveals quantity and imports before building the deck', async () => {
    renderPanel({ context: 'deck' });
    await openProductDetail();

    fireEvent.click(screen.getByRole('switch', { name: 'Also add the cards to my collection' }));
    expect(screen.getByLabelText('Copies')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add 2 cards to collection/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Add 2 cards to collection/ }));
    await waitFor(() => expect(buildDeckMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock).toHaveBeenCalledTimes(1);
  });
});

describe('ProductSearchPanel — Secret Lair (card-list) products', () => {
  it('has no deck switch in either context and stays collection-only', async () => {
    searchProductsMock.mockResolvedValue([SLD_SUMMARY]);
    fetchProductMock.mockResolvedValue(makeSldResolved());

    renderPanel({ context: 'deck' });
    await openProductDetail('Test Drop');

    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: /Add 1 card to collection/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Add 1 card to collection/ }));
    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(buildDeckMock).not.toHaveBeenCalled();
  });
});
