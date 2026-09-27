// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck } from '../../store/decks';
import type { EnrichedCard } from '../../types';

vi.mock('../../store/decks', () => ({ useDecksStore: vi.fn() }));
vi.mock('../../store/collection', () => ({ useCollectionStore: vi.fn() }));
vi.mock('../../store/cube', () => ({ useCubeStore: vi.fn() }));
vi.mock('../../lib/allocations', () => ({ useAllocations: vi.fn() }));

import { useDecksStore } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { useCubeStore } from '../../store/cube';
import { useAllocations } from '../../lib/allocations';
import { YourCardsCard } from './YourCardsCard';

const mockDecks = vi.mocked(useDecksStore);
const mockCollection = vi.mocked(useCollectionStore);
const mockCubes = vi.mocked(useCubeStore);
const mockAllocations = vi.mocked(useAllocations);

type Sel = (s: Record<string, unknown>) => unknown;

let copy = 0;
const card = (name: string, price = 1, importId = 'earlier'): EnrichedCard =>
  ({ name, copyId: `c${copy++}`, purchasePrice: price, importId }) as unknown as EnrichedCard;

const deckCard = (name: string, usd = '0') => ({ card: { name, prices: { usd } } });
const deck = (id: string, name: string, cardNames: Array<[string, string?]>): Deck =>
  ({
    id,
    name,
    color: '#888',
    commander: null,
    partnerCommander: null,
    cards: cardNames.map(([n, usd]) => deckCard(n, usd)),
    sideboard: [],
  }) as unknown as Deck;

function stores(opts: {
  cards?: EnrichedCard[];
  decks?: Deck[];
  importHistory?: unknown[];
  hydrating?: boolean;
}) {
  mockCollection.mockImplementation(((sel: Sel) =>
    sel({
      cards: opts.cards ?? [],
      importHistory: opts.importHistory ?? [],
      hydrating: opts.hydrating ?? false,
    })) as never);
  mockDecks.mockImplementation(((sel: Sel) =>
    sel({ decks: opts.decks ?? [], hydrated: true })) as never);
  mockCubes.mockImplementation(((sel: Sel) => sel({ saved: [] })) as never);
}

const renderCard = () =>
  render(
    <MemoryRouter>
      <YourCardsCard />
    </MemoryRouter>
  );

beforeEach(() => {
  copy = 0;
  localStorage.removeItem('sc-home-shape');
  mockAllocations.mockReturnValue(new Map());
});

describe('YourCardsCard', () => {
  it('shows the skeleton while the collection is hydrating', () => {
    stores({ hydrating: true });
    renderCard();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('renders nothing when there is nothing to act on', () => {
    stores({ cards: [card('Sol Ring')] });
    const { container } = renderCard();
    expect(container.innerHTML).toBe('');
  });

  it('leads with the deck closest to done, then spares, then a shared card', () => {
    stores({
      cards: [card('Sol Ring', 2), card('Sol Ring', 3), card('Lightning Bolt')],
      decks: [
        deck('burn', 'Burn Pile', [['Sol Ring'], ['Fireblast', '4.50'], ['Chain Lightning', '9']]),
        deck('rings', 'Ring Deck', [['Sol Ring'], ['Lightning Bolt']]),
        deck('more', 'More Rings', [['Sol Ring']]),
      ],
    });
    renderCard();
    const links = screen.getAllByRole('link').filter((l) => l.className.includes('your-cards'));
    expect(links.map((l) => l.textContent)).toEqual([
      'Burn Pile2 cards to finish · $14',
      'Spare copies1 copy · $2.00',
      'Sol Ringin 3 decks, you own 2',
    ]);
    expect(links[0].getAttribute('href')).toBe('/decks/burn');
    expect(links[1].getAttribute('href')).toBe('/collection?spares');
    expect(links[2].getAttribute('href')).toBe('/collection?stats');
    expect(screen.getByRole('link', { name: /Breakdown/ }).getAttribute('href')).toBe(
      '/collection?stats'
    );
  });

  it('gives the slot back to Recently added after a partial import this month', () => {
    stores({
      cards: [
        card('Sol Ring'),
        card('Sol Ring'),
        ...Array.from({ length: 20 }, (_, i) => card(`E${i}`)),
      ],
      importHistory: [
        { id: 'new', name: 'x', count: 2, format: 'plain', addedAt: Date.now() - 86_400_000 },
      ],
    });
    const { container } = renderCard();
    expect(container.innerHTML).toBe('');
  });
});
