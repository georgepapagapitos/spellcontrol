// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CubeCard } from '../../lib/cube/core';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import type { ShoppingRow } from '../../lib/cube/shopping-list';
import { useCollectionStore } from '../../store/collection';
import { useCurrencyStore } from '@/lib/currency';
import { pending } from '../../test/pending';
import type { SavedCube } from '../../store/cube';

vi.mock('../../lib/cube/shopping-list', () => ({
  buildShoppingList: vi.fn(),
}));
vi.mock('../../lib/cube/signal', () => ({
  rankedCubeSignalNames: vi.fn(() => ['Ragavan, Nimble Pilferer', 'Solitude']),
  cubeSignalOf: vi.fn(() => ({})),
}));
vi.mock('../../lib/cube/oracle', () => ({
  fetchCubeOracle: vi.fn(async () => new Map()),
}));
vi.mock('../../deck-builder/services/scryfall/client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../deck-builder/services/scryfall/client')>();
  return { ...actual, getCardsByNames: vi.fn(async () => new Map()) };
});

import { buildShoppingList } from '../../lib/cube/shopping-list';
import { getCardsByNames } from '../../deck-builder/services/scryfall/client';
import { CubeShoppingList } from './CubeShoppingList';

const buildShoppingListMock = vi.mocked(buildShoppingList);
const getCardsByNamesMock = vi.mocked(getCardsByNames);

function card(p: Partial<CubeCard>): CubeCard {
  return {
    name: p.name ?? 'Card',
    oracleId: p.oracleId ?? 'oracle',
    colors: p.colors ?? ['R'],
    cmc: p.cmc ?? 2,
    typeLine: p.typeLine ?? 'Creature — Goblin',
    role: p.role ?? null,
  };
}

function makeCube(): GeneratedCube {
  const zero = { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 };
  const weakPick: Pick = {
    card: card({ name: 'Goblin Guide', oracleId: 'goblin-guide' }),
    bucket: 'R',
    reason: '',
  };
  return {
    size: 180,
    format: 'limited',
    picks: [weakPick],
    byBucket: { ...zero, R: 1 },
    targetByBucket: { ...zero, R: 1 },
    gaps: [],
    shortfall: 0,
    poolSize: 1,
  };
}

function saved(over: Partial<SavedCube> = {}): SavedCube {
  return {
    id: 'cube-1',
    name: 'Vintage 540',
    size: 180,
    cube: makeCube(),
    picks: [],
    isPhysical: false,
    savedAt: Date.now(),
    ...over,
  };
}

function shoppingRow(name: string, oracleId: string, improvement = 0.05): ShoppingRow {
  return {
    card: card({ name, oracleId, cmc: 1, typeLine: 'Legendary Creature — Monkey Pirate' }),
    replaces: {
      card: card({ name: 'Goblin Guide', oracleId: 'goblin-guide' }),
      bucket: 'R',
      reason: '',
    },
    improvement,
  };
}

function scryfallCard(over: Partial<ScryfallCard> & { id: string; name: string }): ScryfallCard {
  return {
    set: 'mh2',
    set_name: 'Modern Horizons 2',
    collector_number: '138',
    rarity: 'mythic',
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Legendary Creature — Monkey Pirate',
    colors: ['R'],
    color_identity: ['R'],
    oracle_text: '',
    legalities: {},
    image_uris: { small: 'https://example.test/small.jpg' },
    ...over,
  } as ScryfallCard;
}

beforeEach(() => {
  buildShoppingListMock.mockReset();
  getCardsByNamesMock.mockReset().mockResolvedValue(new Map());
  useCollectionStore.setState({ cards: [], lists: [] });
  useCurrencyStore.setState({ currency: 'USD' });
});

describe('CubeShoppingList', () => {
  it('shows the loading state while candidates and prices are being checked', () => {
    const loadPool = vi.fn(() => pending<CubeCard[] | null>());
    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/Checking cube prices and popularity/)).toBeTruthy();
  });

  it('shows the empty state when nothing beats the cube', async () => {
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([]);
    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);
    await waitFor(() =>
      expect(screen.getByText("Nothing you could buy beats what's in the cube.")).toBeTruthy()
    );
  });

  it('shows an error with a retry that re-runs the whole load', async () => {
    const loadPool = vi
      .fn<() => Promise<CubeCard[] | null>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue([]);
    buildShoppingListMock.mockReturnValue([]);
    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('network down')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(screen.getByText("Nothing you could buy beats what's in the cube.")).toBeTruthy()
    );
    expect(loadPool).toHaveBeenCalledTimes(2);
  });

  it('lists ranked rows with prices and a running total', async () => {
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([
      shoppingRow('Ragavan, Nimble Pilferer', 'ragavan', 0.08),
      shoppingRow('Solitude', 'solitude', 0.04),
    ]);
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        [
          'Ragavan, Nimble Pilferer',
          scryfallCard({ id: 'r1', name: 'Ragavan, Nimble Pilferer', prices: { usd: '58.00' } }),
        ],
        ['Solitude', scryfallCard({ id: 's1', name: 'Solitude', prices: { usd: '42.50' } })],
      ])
    );

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);

    await waitFor(() => expect(screen.getByText('Ragavan, Nimble Pilferer')).toBeTruthy());
    expect(screen.getByText('Solitude')).toBeTruthy();
    expect(screen.getByText('$58.00')).toBeTruthy();
    expect(screen.getByText('$42.50')).toBeTruthy();
    expect(screen.getByText('$100.50')).toBeTruthy();
    expect(screen.getAllByText(/Replaces/).length).toBe(2);
    // Both rows selected by default.
    expect(screen.getByRole('button', { name: /Add selected \(2\) to a want list/ })).toBeTruthy();
  });

  it('an unpriced card is shown, counted, and left out of the total', async () => {
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([
      shoppingRow('Ragavan, Nimble Pilferer', 'ragavan', 0.08),
      shoppingRow('Cavern of Souls', 'cavern', 0.02),
    ]);
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        [
          'Ragavan, Nimble Pilferer',
          scryfallCard({ id: 'r1', name: 'Ragavan, Nimble Pilferer', prices: { usd: '58.00' } }),
        ],
        // Cavern of Souls resolves but carries no price yet.
        ['Cavern of Souls', scryfallCard({ id: 'c1', name: 'Cavern of Souls', prices: {} })],
      ])
    );

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);

    await waitFor(() => expect(screen.getByText('No price yet')).toBeTruthy());
    // One priced row plus the summary total both read $58.00 — Cavern's
    // missing price contributes nothing, so the total equals the priced row.
    expect(screen.getAllByText('$58.00')).toHaveLength(2);
    expect(screen.getByText(/1 without a price yet/)).toBeTruthy();
  });

  it('sends only the selected cards to the chosen want list', async () => {
    useCollectionStore.setState({
      cards: [],
      lists: [
        {
          id: 'list-1',
          name: 'Wants',
          entries: [],
          order: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([
      shoppingRow('Ragavan, Nimble Pilferer', 'ragavan', 0.08),
      shoppingRow('Solitude', 'solitude', 0.04),
    ]);
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        [
          'Ragavan, Nimble Pilferer',
          scryfallCard({ id: 'r1', name: 'Ragavan, Nimble Pilferer', prices: { usd: '58.00' } }),
        ],
        ['Solitude', scryfallCard({ id: 's1', name: 'Solitude', prices: { usd: '42.50' } })],
      ])
    );

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);
    await waitFor(() => expect(screen.getByText('Ragavan, Nimble Pilferer')).toBeTruthy());

    // Deselect Solitude — only Ragavan should be sent.
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Solitude/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add selected \(1\) to a want list/ }));

    expect(screen.getByText(/Save 1 card to a list/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const list = useCollectionStore.getState().lists.find((l) => l.id === 'list-1');
      expect(list?.entries).toHaveLength(1);
      expect(list?.entries[0].name).toBe('Ragavan, Nimble Pilferer');
    });
  });
});
