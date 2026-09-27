// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CubeCard } from '../../lib/cube/core';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import type { ShoppingRow } from '../../lib/cube/shopping-list';
import { useCollectionStore } from '../../store/collection';
import { useCurrencyStore } from '@/lib/currency';
import { pending } from '../../test/pending';
import type { SavedCube } from '../../store/cube';

// Mutable snapshot-readiness state the mocks below close over. Real
// `loadCubeSignal`/`ensureCardTags` gate their reads the same way (empty/[]
// until the snapshot resolves, and never reject even on failure) — this
// reproduces exactly that gate so a test can prove the component AWAITS both
// before reading them, and can distinguish "still loading" from "loaded and
// failed" the same way `hasCubeSignal`/`isCardTagsFailed` do for real.
const snapshotState = vi.hoisted(() => ({
  signalLoaded: true,
  signalWillFail: false,
  tagsLoaded: true,
  tagsWillFail: false,
  tags: new Map<string, string[]>(),
}));

vi.mock('../../lib/cube/shopping-list', () => ({
  buildShoppingList: vi.fn(),
}));
vi.mock('../../lib/cube/signal', () => ({
  rankedCubeSignalNames: vi.fn(() =>
    snapshotState.signalLoaded ? ['Ragavan, Nimble Pilferer', 'Solitude'] : []
  ),
  cubeSignalOf: vi.fn(() => ({})),
  hasCubeSignal: vi.fn(() => snapshotState.signalLoaded),
  loadCubeSignal: vi.fn(async () => {
    if (snapshotState.signalLoaded) return;
    await new Promise((r) => setTimeout(r, 0));
    if (!snapshotState.signalWillFail) snapshotState.signalLoaded = true;
  }),
}));
vi.mock('@/lib/card-tags', () => ({
  isCardTagsFailed: vi.fn(() => snapshotState.tagsWillFail),
  ensureCardTags: vi.fn(async () => {
    if (snapshotState.tagsLoaded) return;
    await new Promise((r) => setTimeout(r, 0));
    if (!snapshotState.tagsWillFail) snapshotState.tagsLoaded = true;
  }),
  getCardTags: vi.fn((name: string) =>
    snapshotState.tagsLoaded ? (snapshotState.tags.get(name) ?? []) : []
  ),
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

/** The toolbar summary's text spans several sibling nodes (the counts sit in
 *  their own `<b>`), so `getByText` can't match it as one string — read the
 *  container's full text instead. */
function summaryText(): string {
  return document.querySelector('.cube-shop-summary')?.textContent ?? '';
}

beforeEach(() => {
  buildShoppingListMock.mockReset();
  getCardsByNamesMock.mockReset().mockResolvedValue(new Map());
  useCollectionStore.setState({ cards: [], lists: [] });
  useCurrencyStore.setState({ currency: 'USD' });
  snapshotState.signalLoaded = true;
  snapshotState.signalWillFail = false;
  snapshotState.tagsLoaded = true;
  snapshotState.tagsWillFail = false;
  snapshotState.tags.clear();
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

  it('shows the error block when the cube-signal snapshot failed to load', async () => {
    // loadCubeSignal swallows its own network error (degrades to "no signal")
    // rather than rejecting — hasCubeSignal() is how the real failure surfaces.
    snapshotState.signalLoaded = false;
    snapshotState.signalWillFail = true;
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([]);

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText("Couldn't load card popularity. Try again.")).toBeTruthy();
    expect(screen.queryByText("Nothing you could buy beats what's in the cube.")).toBeNull();
    expect(buildShoppingListMock).not.toHaveBeenCalled();
  });

  it('shows the error block when oracle tags failed to load', async () => {
    snapshotState.tagsLoaded = false;
    snapshotState.tagsWillFail = true;
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([]);

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText("Couldn't load card popularity. Try again.")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText('$58.00')).toBeTruthy());
    expect(screen.getByText('$42.50')).toBeTruthy();
    expect(screen.getByText('$100.50')).toBeTruthy();
    expect(screen.getAllByText(/Replaces/).length).toBe(2);
    // Both rows fit on the first page, so both are selected by default.
    expect(screen.getByRole('button', { name: /Add 2 to a want list/ })).toBeTruthy();
    expect(summaryText()).toMatch(/2 of 2 selected/);
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

  it('reads "no prices yet" rather than a false "$0.00 total" when every selected card is unpriced', async () => {
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([
      shoppingRow('Cavern of Souls', 'cavern', 0.02),
      shoppingRow('Ancient Tomb', 'tomb', 0.01),
    ]);
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Cavern of Souls', scryfallCard({ id: 'c1', name: 'Cavern of Souls', prices: {} })],
        ['Ancient Tomb', scryfallCard({ id: 't1', name: 'Ancient Tomb', prices: {} })],
      ])
    );

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);

    await waitFor(() => expect(screen.getAllByText('No price yet')).toHaveLength(2));
    expect(summaryText()).toMatch(/2 of 2 selected · no prices yet/);
    expect(summaryText()).not.toMatch(/total/);
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('shows a real total once at least one selected card is priced, alongside the unpriced count', async () => {
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
        ['Cavern of Souls', scryfallCard({ id: 'c1', name: 'Cavern of Souls', prices: {} })],
      ])
    );

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);

    await waitFor(() => expect(screen.getByText('No price yet')).toBeTruthy());
    expect(summaryText()).toMatch(/2 of 2 selected · \$58\.00 total · 1 without a price yet/);
  });

  it('shows a quiet per-row placeholder and "Pricing…" while prices are in flight, never "No price yet" early', async () => {
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([
      shoppingRow('Ragavan, Nimble Pilferer', 'ragavan', 0.08),
      shoppingRow('Cavern of Souls', 'cavern', 0.02),
    ]);
    let resolvePrices!: (v: Map<string, ScryfallCard>) => void;
    getCardsByNamesMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePrices = resolve;
      })
    );

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);
    await waitFor(() => expect(screen.getByText('Ragavan, Nimble Pilferer')).toBeTruthy());

    // Pricing hasn't resolved yet: quiet placeholders, aria-busy list, no
    // premature "No price yet" and no dollar total.
    expect(screen.getByText(/Pricing…/)).toBeTruthy();
    expect(screen.queryByText('No price yet')).toBeNull();
    expect(screen.queryByText(/total/)).toBeNull();
    const list = document.querySelector('.cube-rows');
    expect(list?.getAttribute('aria-busy')).toBe('true');
    expect(within(list as HTMLElement).getAllByText('…').length).toBe(2);

    await act(async () => {
      resolvePrices(
        new Map([
          [
            'Ragavan, Nimble Pilferer',
            scryfallCard({ id: 'r1', name: 'Ragavan, Nimble Pilferer', prices: { usd: '58.00' } }),
          ],
          ['Cavern of Souls', scryfallCard({ id: 'c1', name: 'Cavern of Souls', prices: {} })],
        ])
      );
    });

    await waitFor(() => expect(screen.getByText('No price yet')).toBeTruthy());
    // One priced row plus the summary total both read $58.00.
    expect(screen.getAllByText('$58.00')).toHaveLength(2);
    expect(document.querySelector('.cube-rows')?.getAttribute('aria-busy')).toBe('false');
  });

  it('disables the want-list button until prices resolve, so a send never skips every card as unresolved', async () => {
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([
      shoppingRow('Ragavan, Nimble Pilferer', 'ragavan', 0.08),
    ]);
    let resolvePrices!: (v: Map<string, ScryfallCard>) => void;
    getCardsByNamesMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePrices = resolve;
      })
    );

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);
    await waitFor(() => expect(screen.getByText('Ragavan, Nimble Pilferer')).toBeTruthy());

    const button = screen.getByRole('button', { name: /Add 1 to a want list/ });
    expect(button).toHaveProperty('disabled', true);

    await act(async () => {
      resolvePrices(
        new Map([
          [
            'Ragavan, Nimble Pilferer',
            scryfallCard({ id: 'r1', name: 'Ragavan, Nimble Pilferer', prices: { usd: '58.00' } }),
          ],
        ])
      );
    });

    await waitFor(() => expect(button).toHaveProperty('disabled', false));
  });

  it('keeps the ranked list on a failed price fetch, treating every row as unpriced instead of erroring the tab', async () => {
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([
      shoppingRow('Ragavan, Nimble Pilferer', 'ragavan', 0.08),
      shoppingRow('Solitude', 'solitude', 0.04),
    ]);
    getCardsByNamesMock.mockRejectedValue(new Error('scryfall down'));

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);

    await waitFor(() => expect(screen.getAllByText('No price yet')).toHaveLength(2));
    expect(screen.getByText('Ragavan, Nimble Pilferer')).toBeTruthy();
    expect(screen.getByText('Solitude')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.cube-rows')?.getAttribute('aria-busy')).toBe('false');
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
    // Wait for pricing too — the send handler resolves each card via the same
    // price map, so it must be populated before we click Add.
    await waitFor(() => expect(screen.getByText('$58.00')).toBeTruthy());

    // Deselect Solitude — only Ragavan should be sent.
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Solitude/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add 1 to a want list/ }));

    expect(screen.getByText(/Save 1 card to a list/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const list = useCollectionStore.getState().lists.find((l) => l.id === 'list-1');
      expect(list?.entries).toHaveLength(1);
      expect(list?.entries[0].name).toBe('Ragavan, Nimble Pilferer');
    });
  });

  it('only ticks the visible page by default; Show more ticks the next page, never a hidden row', async () => {
    const allRows = Array.from({ length: 35 }, (_, i) =>
      shoppingRow(`Card ${i}`, `card-${i}`, 0.1 - i * 0.001)
    );
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue(allRows);
    getCardsByNamesMock.mockResolvedValue(new Map());

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);
    await waitFor(() => expect(summaryText()).toMatch(/30 of 35 selected/));
    expect(screen.getByRole('button', { name: /Add 30 to a want list/ })).toBeTruthy();
    expect(screen.getAllByRole('checkbox').length).toBe(30);

    // Select all / Clear selection act on the visible page only.
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(summaryText()).toMatch(/0 of 35 selected/);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(summaryText()).toMatch(/30 of 35 selected/);

    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(35));
    expect(summaryText()).toMatch(/35 of 35 selected/);
  });

  it('renders the name then the price as siblings in a stable column, regardless of name length', async () => {
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([
      shoppingRow('Sh', 'short-name', 0.08),
      shoppingRow('A Very Long Legendary Creature Name Indeed', 'long-name', 0.04),
    ]);
    getCardsByNamesMock.mockResolvedValue(new Map());

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);
    await waitFor(() => expect(screen.getByText('Sh')).toBeTruthy());

    for (const title of document.querySelectorAll('.cube-row-title')) {
      const children = [...title.children];
      expect(children).toHaveLength(2);
      expect(children[0].className).toContain('cube-row-name');
      expect(children[1].className).toContain('cube-row-price');
    }
  });

  it('awaits the cube-signal snapshot before building the candidate list', async () => {
    // Empty until loadCubeSignal resolves — same gate the real module keeps.
    snapshotState.signalLoaded = false;
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([]);

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);
    await waitFor(() => expect(buildShoppingListMock).toHaveBeenCalled());

    // If the walk had run before the signal loaded, this would be [] — the
    // whole point of awaiting it first.
    const [candidates] = buildShoppingListMock.mock.calls[0];
    expect((candidates as CubeCard[]).map((c) => c.name)).toContain('Ragavan, Nimble Pilferer');
  });

  it('excludes a Commander-only candidate once oracle tags load', async () => {
    // Empty (nothing excluded) until ensureCardTags resolves — same gate the
    // real module keeps.
    snapshotState.tagsLoaded = false;
    snapshotState.tags.set('Solitude', ['commander-matters']);
    const loadPool = vi.fn(async () => []);
    buildShoppingListMock.mockReturnValue([]);

    render(<CubeShoppingList target={saved()} loadPool={loadPool} />);
    await waitFor(() => expect(buildShoppingListMock).toHaveBeenCalled());

    // If the walk had run before tags loaded, getCardTags would still read []
    // and Solitude would slip through as a candidate.
    const [candidates] = buildShoppingListMock.mock.calls[0];
    const names = (candidates as CubeCard[]).map((c) => c.name);
    expect(names).toContain('Ragavan, Nimble Pilferer');
    expect(names).not.toContain('Solitude');
  });
});
