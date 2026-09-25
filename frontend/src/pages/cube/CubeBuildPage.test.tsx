// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import type { EnrichedCard } from '../../types';
import type { Friend } from '../../lib/friends-client';
import type { FriendCollectionResponse, FriendCard } from '../../lib/cube/pool';
import type { CubeCard, GeneratedCube } from '../../lib/cube/generate';
import type { OracleFacts } from '../../lib/cube/oracle';
import { CubeBuildPage } from './CubeBuildPage';

const {
  listFriendsMock,
  fetchFriendCollectionMock,
  fetchCubeOracleMock,
  generateCubeAsyncMock,
  getCardsByNamesMock,
} = vi.hoisted(() => ({
  listFriendsMock: vi.fn<() => Promise<Friend[]>>(),
  fetchFriendCollectionMock: vi.fn<(id: string) => Promise<FriendCollectionResponse>>(),
  fetchCubeOracleMock: vi.fn<(names: string[]) => Promise<Map<string, OracleFacts>>>(),
  generateCubeAsyncMock: vi.fn<(pool: CubeCard[], size: number) => Promise<GeneratedCube>>(),
  getCardsByNamesMock: vi.fn(),
}));

vi.mock('../../lib/friends-client', () => ({
  listFriends: listFriendsMock,
}));

// Keep the real pure pool functions (mergePools, filterFriendCards,
// namesToCubePool) — only the network call is a test double.
vi.mock('../../lib/cube/pool', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/cube/pool')>();
  return { ...real, fetchFriendCollection: fetchFriendCollectionMock };
});

// The rest of the generate pipeline (oracle lookup, the generator itself,
// preview-art enrichment) is a real network/CPU workload elsewhere — stub it
// here so a build completes deterministically and fast. The default builds a
// GeneratedCube straight from whatever pool it was handed, so every card
// filterPool/mergePools admitted ends up in `cube.picks` and supplierMap stays
// meaningful.
vi.mock('../../lib/cube/oracle', () => ({ fetchCubeOracle: fetchCubeOracleMock }));
vi.mock('../../lib/cube/generate-async', () => ({ generateCubeAsync: generateCubeAsyncMock }));
vi.mock('../../deck-builder/services/scryfall/client', () => ({
  getCardsByNames: getCardsByNamesMock,
}));

const ZERO_BUCKETS = {
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
  multicolor: 0,
  colorless: 0,
  land: 0,
} as GeneratedCube['byBucket'];

function fakeCube(pool: CubeCard[], size: number): GeneratedCube {
  return {
    size: size as GeneratedCube['size'],
    format: 'limited',
    picks: pool.map((c) => ({ card: c, bucket: 'colorless' as const, reason: 'test' })),
    byBucket: ZERO_BUCKETS,
    targetByBucket: ZERO_BUCKETS,
    gaps: [],
    shortfall: 0,
    poolSize: pool.length,
  };
}

function friend(id: string, username: string, cardCount = 10): Friend {
  return { id, username, displayName: null, friendedAt: 0, cardCount };
}

let seq = 0;
function card(name: string, over: Partial<EnrichedCard> = {}): EnrichedCard {
  seq += 1;
  return {
    copyId: `copy-${seq}`,
    name,
    setCode: 'CMM',
    setName: 'Commander Masters',
    collectorNumber: String(seq),
    rarity: 'uncommon',
    scryfallId: `sf-${seq}`,
    purchasePrice: 1.5,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Artifact',
    cmc: 1,
    colorIdentity: [],
    colors: [],
    legalities: { commander: 'legal' },
    ...over,
  } as EnrichedCard;
}

beforeEach(() => {
  seq = 0;
  useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [] });
  useCollectionStore.setState({
    cards: [card('Sol Ring'), card('Arcane Signet'), card('Swords to Plowshares')],
  });
  useDecksStore.setState({ decks: [] });
  localStorage.clear();
  listFriendsMock.mockReset().mockResolvedValue([]);
  fetchFriendCollectionMock.mockReset();
  fetchCubeOracleMock.mockReset().mockResolvedValue(new Map());
  getCardsByNamesMock.mockReset().mockResolvedValue(new Map());
  generateCubeAsyncMock
    .mockReset()
    .mockImplementation((pool, size) => Promise.resolve(fakeCube(pool, size)));
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CubeBuildPage />
    </MemoryRouter>
  );
}

describe('CubeBuildPage — card priority', () => {
  it('Power / Balanced / Themed map to synergyLevel 0 / 0.5 / 1 and each shows its own note', () => {
    renderPage();
    const power = screen.getByRole('radio', { name: 'Power' });
    const balanced = screen.getByRole('radio', { name: 'Balanced' });
    const themed = screen.getByRole('radio', { name: 'Themed' });
    expect((power as HTMLInputElement).value).toBe('0');
    expect((balanced as HTMLInputElement).value).toBe('0.5');
    expect((themed as HTMLInputElement).value).toBe('1');
    expect(power.hasAttribute('checked') || (power as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/no archetype shaping/)).toBeTruthy();

    fireEvent.click(themed);
    expect(screen.getByText(/collection can actually support/)).toBeTruthy();
  });
});

describe('CubeBuildPage — size', () => {
  it('shows how many cards short the filtered pool is of each size', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Cube size/ }));
    // 3 cards owned, a 540 cube needs 540 — the option states the shortfall.
    expect(screen.getAllByText(/540.*short/).length).toBeGreaterThan(0);
  });
});

describe('CubeBuildPage — Draw from', () => {
  it('the closed Disclosure states the current pool setting', () => {
    renderPage();
    expect(screen.getByText('Available cards · any price · any rarity')).toBeTruthy();
  });
});

describe('CubeBuildPage — friends as a pool source', () => {
  it('picking a friend changes the Draw-from summary', async () => {
    listFriendsMock.mockResolvedValue([friend('f1', 'Alex')]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Draw from/, expanded: false }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Build with Alex' });
    fireEvent.click(checkbox);
    // Close the disclosure — its summary only renders while closed.
    fireEvent.click(screen.getByRole('button', { name: /Draw from/, expanded: true }));

    expect(screen.getByText('Available cards · any price · any rarity · with Alex')).toBeTruthy();
  });

  it('no friends yet explains itself instead of hiding the picker', async () => {
    listFriendsMock.mockResolvedValue([]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Draw from/, expanded: false }));
    expect(await screen.findByText(/don't have any friends yet/)).toBeTruthy();
  });

  it('a private friend shows its state after a build attempt', async () => {
    listFriendsMock.mockResolvedValue([friend('f1', 'Jordan')]);
    fetchFriendCollectionMock.mockResolvedValue({
      ownerUsername: 'jordan',
      collectionPrivate: true,
      cards: [],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Draw from/, expanded: false }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Build with Jordan' });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /Build cube/ }));

    expect(
      await screen.findByText("Jordan's collection is private. Their cards were excluded.")
    ).toBeTruthy();
  });

  it('saving a build keeps who supplies what', async () => {
    listFriendsMock.mockResolvedValue([friend('f1', 'Alex')]);
    const bolt: FriendCard = {
      name: 'Lightning Bolt',
      oracleId: 'lb-oracle',
      colors: ['R'],
      cmc: 1,
      typeLine: 'Instant',
      rarity: 'common',
    };
    fetchFriendCollectionMock.mockResolvedValue({ ownerUsername: 'alex', cards: [bolt] });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Draw from/, expanded: false }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Build with Alex' });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /Draw from/, expanded: true }));
    fireEvent.click(screen.getByRole('button', { name: /Build cube/ }));

    await screen.findByRole('button', { name: 'Save cube' });
    fireEvent.click(screen.getByRole('button', { name: 'Save cube' }));
    fireEvent.change(screen.getByLabelText('Cube name'), { target: { value: 'Our cube' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(useCubeStore.getState().saved).toHaveLength(1));
    const saved = useCubeStore.getState().saved[0];
    expect(saved.name).toBe('Our cube');
    expect(saved.suppliers?.['lb-oracle']).toEqual(['Alex']);
  });
});
