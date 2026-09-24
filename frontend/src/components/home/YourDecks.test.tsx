// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Deck } from '../../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('../../store/decks', () => ({
  useDecksStore: vi.fn(),
}));

vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: never[]; importHistory: never[] }) => unknown) =>
    sel({ cards: [], importHistory: [] }),
}));

const awaiting = vi.hoisted(() => ({ value: false }));
vi.mock('../../lib/use-awaiting-first-pull', () => ({
  useAwaitingFirstPull: () => awaiting.value,
}));

const arrivals = vi.hoisted(() => ({ rows: [] as Array<{ deck: { id: string }; count: number }> }));
vi.mock('../../lib/home-signals', () => ({
  aggregateNewArrivalDecks: () => arrivals.rows,
}));

const mockUseCardThumb = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
vi.mock('../../lib/card-thumbs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/card-thumbs')>();
  return { ...actual, useCardThumb: mockUseCardThumb };
});

import { YourDecks } from './YourDecks';
import { useDecksStore } from '../../store/decks';

const mockUseDecksStore = useDecksStore as unknown as ReturnType<typeof vi.fn>;

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

function commander(overrides: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: overrides.name,
    oracle_id: overrides.name,
    cmc: 2,
    type_line: 'Legendary Creature — Human',
    color_identity: [],
    keywords: [],
    rarity: 'mythic',
    set: 'tst',
    set_name: 'Test Set',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function setStore(decks: Deck[], hydrated = true) {
  mockUseDecksStore.mockImplementation(
    (sel: (s: { decks: Deck[]; hydrated: boolean }) => unknown) => sel({ decks, hydrated })
  );
}

function renderSection() {
  return render(
    <MemoryRouter>
      <YourDecks />
    </MemoryRouter>
  );
}

const deckLinks = () =>
  screen
    .getAllByRole('link')
    .filter((l) => /^\/decks\/[^/?]+$/.test(l.getAttribute('href') ?? ''))
    .filter((l) => l.getAttribute('href') !== '/decks/new');

describe('YourDecks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('sc-home-shape');
    mockUseCardThumb.mockReturnValue(undefined);
    awaiting.value = false;
    arrivals.rows = [];
  });

  it('shows tile skeletons while decks are not yet hydrated', () => {
    setStore([], false);
    renderSection();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('keeps loading, never vanishing, while a fresh device awaits its first pull', () => {
    awaiting.value = true;
    setStore([], true);
    renderSection();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('renders nothing at all with no decks — the hero and Waiting on you invite the first', () => {
    setStore([], true);
    const { container } = renderSection();
    expect(container.innerHTML).toBe('');
  });

  it('a remembered empty section stays absent while loading', () => {
    localStorage.setItem('sc-home-shape', JSON.stringify({ 'your-decks': 0 }));
    setStore([], false);
    const { container } = renderSection();
    expect(container.innerHTML).toBe('');
  });

  it('sorts tiles by updatedAt descending', () => {
    setStore([
      makeDeck({ id: 'old', name: 'Old Deck', updatedAt: 100 }),
      makeDeck({ id: 'latest', name: 'Latest Deck', updatedAt: 300 }),
      makeDeck({ id: 'mid', name: 'Mid Deck', updatedAt: 200 }),
    ]);
    renderSection();
    expect(deckLinks().map((l) => l.getAttribute('href'))).toEqual([
      '/decks/latest',
      '/decks/mid',
      '/decks/old',
    ]);
  });

  it('caps the row at 5 decks and names the full count on the door', () => {
    const decks = Array.from({ length: 8 }, (_, i) =>
      makeDeck({ id: `d${i}`, name: `Deck ${i}`, updatedAt: i })
    );
    setStore(decks);
    renderSection();
    const hrefs = deckLinks().map((l) => l.getAttribute('href'));
    expect(hrefs).toHaveLength(5);
    expect(hrefs).not.toContain('/decks/d0');
    expect(screen.getByRole('link', { name: 'All 8' }).getAttribute('href')).toBe('/decks');
  });

  it('links each tile to its deck with a descriptive label, incl. relative edited time', () => {
    setStore([
      makeDeck({
        id: 'atraxa',
        name: "Atraxa, Praetors' Voice",
        updatedAt: Date.now() - 2 * 60 * 60 * 1000,
      }),
    ]);
    renderSection();
    const link = screen.getByRole('link', {
      name: "Open deck: Atraxa, Praetors' Voice, Commander, edited 2h ago",
    });
    expect(link.getAttribute('href')).toBe('/decks/atraxa');
  });

  it("puts a deck's new-card count on its tile, in the label and on the art", () => {
    arrivals.rows = [{ deck: { id: 'a' }, count: 42 }];
    setStore([makeDeck({ id: 'a', name: 'Anthraxa' })]);
    const { container } = renderSection();
    expect(
      screen.getByRole('link', { name: /Open deck: Anthraxa, .*, 42 new cards that fit/ })
    ).toBeTruthy();
    expect(container.querySelector('.home-deck-arrivals')?.textContent).toBe('+42 new cards');
  });

  it("renders the commander's art crop straight from the card object, no CDN lookup", () => {
    setStore([
      makeDeck({
        id: 'atraxa',
        name: 'Atraxa Superfriends',
        commander: commander({
          name: "Atraxa, Praetors' Voice",
          image_uris: {
            small: 's.png',
            normal: 'n.png',
            large: 'l.png',
            png: 'p.png',
            art_crop: 'https://cards.scryfall.io/art_crop/front/a/b/ab.jpg',
            border_crop: 'b.png',
          },
        }),
      }),
    ]);
    const { container } = renderSection();
    const img = container.querySelector('.decks-index-card-art') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toContain('art_crop');
    expect(mockUseCardThumb).toHaveBeenCalledWith(undefined, 'art_crop');
    expect(screen.getByText("Atraxa, Praetors' Voice")).toBeTruthy();
  });

  it('falls back to the CDN art crop when the commander object carries none', () => {
    mockUseCardThumb.mockReturnValue('cdn-resolved.png');
    setStore([
      makeDeck({ id: 'a', name: 'A', commander: commander({ name: 'Sol Ring Commander' }) }),
    ]);
    const { container } = renderSection();
    expect(mockUseCardThumb).toHaveBeenCalledWith('Sol Ring Commander', 'art_crop');
    const img = container.querySelector('.decks-index-card-art') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('cdn-resolved.png');
  });

  it('falls back to the deck-colour banner when the deck has no commander', () => {
    setStore([makeDeck({ id: 'a', name: 'A', commander: null, color: '#ff0000' })]);
    const { container } = renderSection();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.decks-index-card-banner')).toBeTruthy();
    const tile = container.querySelector('.decks-index-card') as HTMLElement;
    expect(tile.style.getPropertyValue('--deck-color')).toBe('#ff0000');
  });

  it('searches your decks from its own search box', () => {
    setStore([makeDeck({ id: 'a', name: 'A' })]);
    renderSection();
    expect(screen.getByLabelText('Search your decks', { selector: 'input' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Search your decks' }).getAttribute('href')).toBe(
      '/decks'
    );
  });
});
