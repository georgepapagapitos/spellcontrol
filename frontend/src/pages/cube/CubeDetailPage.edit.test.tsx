// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCubeStore, type SavedCube } from '../../store/cube';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useToastsStore } from '../../store/toasts';
import {
  resetSuggestionLabelsForTests,
  setSuggestionLabelsEnabled,
} from '@/lib/util/suggestion-labels';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import type { CubeCard } from '../../lib/cube/core';

vi.mock('../../deck-builder/services/scryfall/client', () => ({
  getCardsByNames: vi.fn(() => Promise.resolve(new Map())),
}));

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', () => ({
  sendBeaconPayload: (p: Record<string, unknown>) => sent.push(p),
  normalizePath: (p: string) => p,
}));

const { SWAP_POOL } = vi.hoisted(() => ({
  SWAP_POOL: [
    {
      name: 'Monastery Swiftspear',
      oracleId: 'oracle-Monastery Swiftspear',
      colors: ['R'],
      cmc: 1,
      typeLine: 'Creature',
      role: null,
    },
  ],
}));
vi.mock('../../lib/cube/use-owned-pool', () => ({
  useOwnedCubePool: () => ({
    pool: SWAP_POOL,
    uniqueNames: [],
    hidden: {
      basics: 0,
      committed: 0,
      singles: 0,
      rarity: 0,
      price: 0,
      unpriced: 0,
      commanderOnly: 0,
      politics: 0,
    },
    loading: false,
    error: '',
    load: vi.fn(async () => SWAP_POOL),
  }),
}));

const { generateCubeAsyncMock } = vi.hoisted(() => ({ generateCubeAsyncMock: vi.fn() }));
vi.mock('../../lib/cube/generate-async', () => ({
  generateCubeAsync: generateCubeAsyncMock,
}));

import { CubeDetailPage } from './CubeDetailPage';

function card(name: string, over: Partial<CubeCard> = {}): CubeCard {
  return {
    name,
    oracleId: `oracle-${name}`,
    colors: ['R'],
    cmc: 1,
    typeLine: 'Instant',
    role: null,
    ...over,
  };
}
function pick(name: string, over: Partial<CubeCard> = {}): Pick {
  return { card: card(name, over), bucket: 'R', reason: 'goodstuff' };
}

function makeCube(picks: Pick[]): GeneratedCube {
  const byBucket = {
    W: 0,
    U: 0,
    B: 0,
    R: picks.length,
    G: 0,
    multicolor: 0,
    colorless: 0,
    land: 0,
  } as const;
  return {
    size: 180,
    format: 'limited',
    picks,
    byBucket: { ...byBucket },
    targetByBucket: { ...byBucket },
    gaps: [],
    shortfall: 0,
    poolSize: picks.length,
  };
}

function saved(over: Partial<SavedCube> = {}): SavedCube {
  return {
    id: 'cube-1',
    name: 'Vintage 540',
    size: 180,
    cube: makeCube([pick('Lightning Bolt')]),
    picks: [],
    isPhysical: false,
    savedAt: Date.now(),
    ...over,
  };
}

const writeText = vi.fn(async () => {});

beforeEach(() => {
  useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [] });
  useCollectionStore.setState({ cards: [] });
  useDecksStore.setState({ decks: [] });
  useToastsStore.setState({ toasts: [] });
  localStorage.clear();
  sent.length = 0;
  resetSuggestionLabelsForTests();
  writeText.mockClear();
  generateCubeAsyncMock.mockReset();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/decks/cube/:id" element={<CubeDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function switchToList() {
  await waitFor(() => expect(screen.getByText('Color balance')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'List view (with reasons)' }));
}

describe('CubeDetailPage — lock', () => {
  it('toggles and shows "Locked" on the row', async () => {
    useCubeStore.setState({ saved: [saved()] });
    renderAt('/decks/cube/cube-1');
    await switchToList();

    const lockBtn = screen.getByRole('button', { name: 'Lock Lightning Bolt' });
    expect(lockBtn.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(lockBtn);

    expect(screen.getByText('Locked')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Unlock Lightning Bolt' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(useCubeStore.getState().saved[0].locked).toEqual(['oracle-Lightning Bolt']);
  });
});

describe('CubeDetailPage — swap', () => {
  it('lists candidates and applying one replaces the card', async () => {
    useCubeStore.setState({ saved: [saved({ cube: makeCube([pick('Goblin Guide')]) })] });
    renderAt('/decks/cube/cube-1');
    await switchToList();

    fireEvent.click(screen.getByRole('button', { name: 'Swap Goblin Guide' }));
    expect(await screen.findByRole('heading', { name: 'Swap Goblin Guide' })).toBeTruthy();

    const useBtn = await screen.findByRole('button', { name: 'Use' });
    fireEvent.click(useBtn);

    await waitFor(() => {
      const names = useCubeStore.getState().saved[0].cube.picks.map((p) => p.card.name);
      expect(names).toContain('Monastery Swiftspear');
      expect(names).not.toContain('Goblin Guide');
    });
  });
});

describe('CubeDetailPage — swap suggestion labels', () => {
  const openSwap = async () => {
    useCubeStore.setState({
      saved: [saved({ id: 'cube-secret-1', cube: makeCube([pick('Goblin Guide')]) })],
    });
    renderAt('/decks/cube/cube-secret-1');
    await switchToList();
    fireEvent.click(screen.getByRole('button', { name: 'Swap Goblin Guide' }));
    return screen.findByRole('button', { name: 'Use' });
  };

  it('counts the list once and labels the picked candidate with its rank, with no commander or cube id', async () => {
    fireEvent.click(await openSwap());
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([
      expect.objectContaining({ surface: 'cube-swap', action: 'shown', n: 1 }),
      expect.objectContaining({
        surface: 'cube-swap',
        action: 'accept',
        rank: 1,
        reason: 'red',
        cardIn: 'Monastery Swiftspear',
        cardOut: 'Goblin Guide',
      }),
    ]);
    const body = JSON.stringify(sent);
    expect(body).not.toContain('cube-secret-1');
    expect(sent.every((p) => !('cmdr' in p) && !('cmdrName' in p))).toBe(true);
  });

  it('labels closing the sheet without a pick as a dismiss of the card kept', async () => {
    await openSwap();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(sent).toEqual([
      expect.objectContaining({ action: 'shown', n: 1 }),
      expect.objectContaining({
        surface: 'cube-swap',
        action: 'dismiss',
        cardOut: 'Goblin Guide',
      }),
    ]);
    expect(sent[1]).not.toHaveProperty('cardIn');
  });

  it('sends nothing when the player opted out', async () => {
    setSuggestionLabelsEnabled(false);
    fireEvent.click(await openSwap());
    await waitFor(() =>
      expect(useCubeStore.getState().saved[0].cube.picks[0].card.name).toBe('Monastery Swiftspear')
    );
    expect(sent).toEqual([]);
  });
});

describe('CubeDetailPage — ban', () => {
  it('confirms and moves the card to banned', async () => {
    useCubeStore.setState({ saved: [saved()] });
    renderAt('/decks/cube/cube-1');
    await switchToList();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Lightning Bolt' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ban from this cube…' }));
    expect(screen.getByRole('heading', { name: 'Ban Lightning Bolt?' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ban card' }));

    expect(useCubeStore.getState().saved[0].banned).toEqual(['oracle-Lightning Bolt']);
    expect(useCubeStore.getState().saved[0].cube.picks).toHaveLength(0);
  });
});

describe('CubeDetailPage — rebuild', () => {
  it('keeps locked cards and respects bans, passing both to the generator', async () => {
    generateCubeAsyncMock.mockImplementation(
      async (_pool: CubeCard[], _size: number, options: { locked: CubeCard[]; banned: string[] }) =>
        makeCube([
          ...options.locked
            .map((c) => pick(c.name).card)
            .map((c) => ({ card: c, bucket: 'R' as const, reason: 'kept' })),
          pick('Fresh Pick'),
        ])
    );
    const cube = saved({
      cube: makeCube([pick('Lightning Bolt'), pick('Goblin Guide')]),
      locked: ['oracle-Lightning Bolt'],
      banned: ['oracle-Old Card'],
    });
    useCubeStore.setState({ saved: [cube] });
    renderAt('/decks/cube/cube-1');
    await waitFor(() => expect(screen.getByText('Color balance')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Rebuild the rest' }));
    // Singular: exactly one locked card in the cube.
    expect(screen.getByText('Rebuild 1 unlocked cards? Your locked card stay.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }));

    await waitFor(() => expect(generateCubeAsyncMock).toHaveBeenCalled());
    const options = generateCubeAsyncMock.mock.calls[0][2] as {
      locked: CubeCard[];
      banned: string[];
    };
    expect(options.locked.map((c) => c.oracleId)).toEqual(['oracle-Lightning Bolt']);
    expect(options.banned).toEqual(['oracle-Old Card']);

    await waitFor(() => {
      const names = useCubeStore.getState().saved[0].cube.picks.map((p) => p.card.name);
      expect(names).toContain('Fresh Pick');
    });
    await waitFor(() => {
      const toasts = useToastsStore.getState().toasts;
      expect(
        toasts.some((t) => t.message === 'Rebuilt "Vintage 540". Your locked card stayed.')
      ).toBe(true);
    });
  });

  it('pluralizes the locked-card count when rebuilding with more than one locked', async () => {
    generateCubeAsyncMock.mockImplementation(
      async (_pool: CubeCard[], _size: number, options: { locked: CubeCard[]; banned: string[] }) =>
        makeCube([
          ...options.locked
            .map((c) => pick(c.name).card)
            .map((c) => ({ card: c, bucket: 'R' as const, reason: 'kept' })),
          pick('Fresh Pick'),
        ])
    );
    const cube = saved({
      cube: makeCube([pick('Lightning Bolt'), pick('Goblin Guide'), pick('Third Card')]),
      locked: ['oracle-Lightning Bolt', 'oracle-Goblin Guide'],
    });
    useCubeStore.setState({ saved: [cube] });
    renderAt('/decks/cube/cube-1');
    await waitFor(() => expect(screen.getByText('Color balance')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Rebuild the rest' }));
    expect(screen.getByText('Rebuild 1 unlocked cards? Your 2 locked cards stay.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }));

    await waitFor(() => expect(generateCubeAsyncMock).toHaveBeenCalled());
    await waitFor(() => {
      const toasts = useToastsStore.getState().toasts;
      expect(
        toasts.some((t) => t.message === 'Rebuilt "Vintage 540". Your 2 locked cards stayed.')
      ).toBe(true);
    });
  });
});

describe('CubeDetailPage — header actions', () => {
  it('Copy cube list moved into the header overflow menu', async () => {
    useCubeStore.setState({ saved: [saved()] });
    renderAt('/decks/cube/cube-1');
    await waitFor(() => expect(screen.getByText('Color balance')).toBeTruthy());

    expect(screen.queryByRole('button', { name: 'Copy cube list' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const copyItem = screen.getByRole('menuitem', { name: 'Copy cube list' });
    fireEvent.click(copyItem);

    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });
});
