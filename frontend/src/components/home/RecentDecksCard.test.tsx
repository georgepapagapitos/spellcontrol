// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Deck } from '../../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('../../store/decks', () => ({
  useDecksStore: vi.fn(),
}));

const mockUseCardThumb = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
vi.mock('../../lib/card-thumbs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/card-thumbs')>();
  return { ...actual, useCardThumb: mockUseCardThumb };
});

import { RecentDecksCard } from './RecentDecksCard';
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

function renderCard() {
  return render(
    <MemoryRouter>
      <RecentDecksCard />
    </MemoryRouter>
  );
}

describe('RecentDecksCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCardThumb.mockReturnValue(undefined);
  });

  it('shows the loading skeleton while decks are not yet hydrated', () => {
    setStore([], false);
    renderCard();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('renders the empty state with a "Create a deck" CTA when there are no decks', () => {
    setStore([], true);
    renderCard();
    expect(screen.getByText('No decks yet.')).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Create a deck' });
    expect(cta.getAttribute('href')).toBe('/decks/new');
  });

  it('sorts rows by updatedAt descending', () => {
    setStore([
      makeDeck({ id: 'old', name: 'Old Deck', updatedAt: 100 }),
      makeDeck({ id: 'new', name: 'New Deck', updatedAt: 300 }),
      makeDeck({ id: 'mid', name: 'Mid Deck', updatedAt: 200 }),
    ]);
    renderCard();
    const links = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.startsWith('/decks/'));
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/decks/new',
      '/decks/mid',
      '/decks/old',
    ]);
  });

  it('caps the rail at 5 decks', () => {
    const decks = Array.from({ length: 8 }, (_, i) =>
      makeDeck({ id: `d${i}`, name: `Deck ${i}`, updatedAt: i })
    );
    setStore(decks);
    renderCard();
    const links = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.startsWith('/decks/'));
    expect(links).toHaveLength(5);
    // The 3 oldest (lowest updatedAt) are dropped.
    expect(links.map((l) => l.getAttribute('href'))).not.toContain('/decks/d0');
    expect(links.map((l) => l.getAttribute('href'))).not.toContain('/decks/d2');
  });

  it('links each row to its deck editor with a descriptive aria-label', () => {
    setStore([makeDeck({ id: 'atraxa', name: "Atraxa, Praetors' Voice", format: 'commander' })]);
    renderCard();
    const link = screen.getByRole('link', {
      name: "Open deck: Atraxa, Praetors' Voice, Commander",
    });
    expect(link.getAttribute('href')).toBe('/decks/atraxa');
  });

  it('points "View all" at the decks index when decks exist', () => {
    setStore([makeDeck({ id: 'a', name: 'A' })]);
    renderCard();
    const viewAll = screen.getByRole('link', { name: 'View all' });
    expect(viewAll.getAttribute('href')).toBe('/decks');
  });

  it("renders the commander's art directly from the card object with no CDN lookup", () => {
    setStore([
      makeDeck({
        id: 'atraxa',
        name: 'Atraxa Superfriends',
        commander: commander({
          name: "Atraxa, Praetors' Voice",
          image_uris: {
            small: 's.png',
            normal: 'atraxa-normal.png',
            large: 'l.png',
            png: 'p.png',
            art_crop: 'a.png',
            border_crop: 'b.png',
          },
        }),
      }),
    ]);
    const { container } = renderCard();
    const img = container.querySelector('.home-thumb img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('atraxa-normal.png');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(mockUseCardThumb).toHaveBeenCalledWith(undefined, 'normal');
  });

  it('falls back to the CDN thumb when the commander object carries no direct art', () => {
    mockUseCardThumb.mockReturnValue('cdn-resolved.png');
    setStore([
      makeDeck({ id: 'a', name: 'A', commander: commander({ name: 'Sol Ring Commander' }) }),
    ]);
    const { container } = renderCard();
    expect(mockUseCardThumb).toHaveBeenCalledWith('Sol Ring Commander', 'normal');
    const img = container.querySelector('.home-thumb img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('cdn-resolved.png');
  });

  it('falls back to a color-pip banner (never the CDN thumb) when the deck has no commander', () => {
    setStore([makeDeck({ id: 'a', name: 'A', commander: null, color: '#ff0000' })]);
    const { container } = renderCard();
    expect(container.querySelector('.home-thumb img')).toBeNull();
    const banner = container.querySelector('.home-thumb-banner') as HTMLElement | null;
    expect(banner).toBeTruthy();
    expect(banner?.style.getPropertyValue('--deck-color')).toBe('#ff0000');
    expect(mockUseCardThumb).toHaveBeenCalledWith(undefined, 'normal');
  });
});
