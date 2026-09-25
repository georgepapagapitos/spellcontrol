// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCubeStore, type SavedCube } from '../../store/cube';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import type { CubeCard } from '../../lib/cube/core';

vi.mock('../../deck-builder/services/scryfall/client', () => ({
  getCardsByNames: vi.fn(() => Promise.resolve(new Map())),
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
  localStorage.clear();
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
