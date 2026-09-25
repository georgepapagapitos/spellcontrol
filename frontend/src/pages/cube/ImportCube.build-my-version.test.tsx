// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import type { CubeCard } from '../../lib/cube/core';
import type { CubeCobraCard, ImportedCube } from '../../lib/cube/import';
import type { ScryfallCard } from '@/deck-builder/types';

function fakeScryfall(name: string): ScryfallCard {
  return {
    id: `sf-${name}`,
    oracle_id: `oid-${name}`,
    name,
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    cmc: 1,
    type_line: 'Instant',
    colors: [],
    color_identity: [],
    legalities: {},
  } as unknown as ScryfallCard;
}

const hoisted = vi.hoisted(() => ({
  fetchCubeCobraCube: vi.fn(),
  loadPool: vi.fn(),
  pool: { fixture: [] as CubeCard[] },
  hasCollection: { value: true },
}));
const { fetchCubeCobraCube, loadPool } = hoisted;

vi.mock('../../lib/cube/import', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/cube/import')>('../../lib/cube/import');
  return { ...actual, fetchCubeCobraCube: hoisted.fetchCubeCobraCube };
});

vi.mock('./use-owned-cube-pool', () => ({
  useOwnedCubePool: () => ({
    load: (...args: unknown[]) => {
      hoisted.loadPool(...args);
      return Promise.resolve(hoisted.pool.fixture);
    },
    hasCollection: hoisted.hasCollection.value,
  }),
}));

vi.mock('../../deck-builder/services/scryfall/client', () => ({
  getCardsByNames: vi.fn((names: string[]) =>
    Promise.resolve(new Map(names.map((n) => [n, fakeScryfall(n)])))
  ),
}));

import { ImportCube } from './ImportCube';

// Three imported cards, engineered against the fixed pool below so the build
// lands exactly one card in each bucket:
// - "Owned Bear" shares an oracleId with a pool card → kept.
// - "Missing Bolt" has no oracleId match, but the pool has a same-color
//   same-type same-slot instant → substituted.
// - "Unmatched Sphinx" has nothing in the pool anywhere close → no match.
const importedCards: CubeCobraCard[] = [
  {
    name: 'Owned Bear',
    oracleId: 'oid-bear',
    cmc: 2,
    typeLine: 'Creature — Bear',
    colors: ['G'],
    image: 'https://example.com/bear.jpg',
  },
  {
    name: 'Missing Bolt',
    oracleId: 'oid-bolt',
    cmc: 1,
    typeLine: 'Instant',
    colors: ['R'],
    image: 'https://example.com/bolt.jpg',
  },
  {
    name: 'Unmatched Sphinx',
    oracleId: 'oid-sphinx',
    cmc: 6,
    typeLine: 'Creature — Sphinx',
    colors: ['U'],
    image: 'https://example.com/sphinx.jpg',
  },
];

function importedCube(): ImportedCube {
  return {
    id: 'legacy-cube',
    name: 'Legacy Cube',
    cardCount: importedCards.length,
    likeCount: 42,
    cards: importedCards,
  };
}

beforeEach(() => {
  hoisted.hasCollection.value = true;
  hoisted.pool.fixture = [
    {
      name: 'Owned Bear',
      oracleId: 'oid-bear',
      colors: ['G'],
      cmc: 2,
      typeLine: 'Creature — Bear',
      role: null,
    },
    {
      name: 'Red Bolt Alt',
      oracleId: 'oid-bolt-alt',
      colors: ['R'],
      cmc: 1,
      typeLine: 'Instant',
      role: null,
    },
  ];
  useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [] });
  useCollectionStore.setState({ cards: [], lists: [] });
  useDecksStore.setState({ decks: [] });
  localStorage.clear();
  fetchCubeCobraCube.mockReset();
  loadPool.mockClear();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/decks/cube/new/import']}>
      <Routes>
        <Route path="/decks/cube/new/import" element={<ImportCube />} />
        <Route path="/decks/cube/:id" element={<div>Cube page opened</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function importAndBuild() {
  renderPage();
  fireEvent.change(screen.getByLabelText('CubeCobra cube link'), {
    target: { value: 'https://cubecobra.com/cube/overview/legacy-cube' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => screen.getByRole('button', { name: 'Build my version' }));
  fireEvent.click(screen.getByRole('button', { name: 'Build my version' }));
  await waitFor(() => screen.getByRole('heading', { name: /My version of Legacy Cube/ }));
}

describe('Import a cube → Build my version', () => {
  it('shows the primary action once an import finishes', async () => {
    fetchCubeCobraCube.mockResolvedValue(importedCube());
    renderPage();
    fireEvent.change(screen.getByLabelText('CubeCobra cube link'), {
      target: { value: 'https://cubecobra.com/cube/overview/legacy-cube' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => screen.getByRole('button', { name: 'Build my version' }));
    expect(screen.getByText(/closest match for the rest/)).toBeTruthy();
  });

  it('renders Kept / Swapped / No match, names both sides of a swap, and states the size', async () => {
    fetchCubeCobraCube.mockResolvedValue(importedCube());
    await importAndBuild();

    const versionSection = within(screen.getByRole('region', { name: 'Your version of the cube' }));

    expect(versionSection.getByRole('heading', { name: 'Kept (1)' })).toBeTruthy();
    expect(versionSection.getByRole('heading', { name: 'Swapped (1)' })).toBeTruthy();
    expect(versionSection.getByRole('heading', { name: 'No match (1)' })).toBeTruthy();

    // Both sides of the one substitution are named — never a bare arrow.
    expect(versionSection.getByText('Missing Bolt')).toBeTruthy();
    expect(versionSection.getByText('Red Bolt Alt')).toBeTruthy();

    expect(
      versionSection.getByText(/The original has 3 cards\. Your version is a 180-card cube\./)
    ).toBeTruthy();
    expect(
      versionSection.getByText(
        /You own 1 of 3\. 1 swapped for your closest match\. 1 have no match\./
      )
    ).toBeTruthy();
  });

  it('saving navigates to the new cube page', async () => {
    fetchCubeCobraCube.mockResolvedValue(importedCube());
    await importAndBuild();

    fireEvent.click(screen.getByRole('button', { name: 'Save this cube' }));
    const nameInput = await screen.findByLabelText('Cube name');
    expect((nameInput as HTMLInputElement).value).toBe('Legacy Cube (my version)');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => screen.getByText('Cube page opened'));
    expect(useCubeStore.getState().saved).toHaveLength(1);
  });

  it("sends the cards you don't own to a want list", async () => {
    fetchCubeCobraCube.mockResolvedValue(importedCube());
    await importAndBuild();

    const listBtn = screen.getByRole('button', { name: /Send 2 missing cards to a want list/ });
    fireEvent.click(listBtn);

    const nameInput = await screen.findByLabelText('List name');
    fireEvent.change(nameInput, { target: { value: 'Cube pickups' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const lists = useCollectionStore.getState().lists;
      expect(lists).toHaveLength(1);
      expect(lists[0].entries).toHaveLength(2);
    });
  });

  it('invites importing a collection first when there is none to draw from', async () => {
    hoisted.hasCollection.value = false;
    fetchCubeCobraCube.mockResolvedValue(importedCube());
    renderPage();
    fireEvent.change(screen.getByLabelText('CubeCobra cube link'), {
      target: { value: 'https://cubecobra.com/cube/overview/legacy-cube' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => screen.getByText(/Import your collection first/));
    expect(screen.queryByRole('button', { name: 'Build my version' })).toBeNull();
  });

  it('shows an error with a retry when the import fails', async () => {
    fetchCubeCobraCube.mockRejectedValue(new Error('boom'));
    renderPage();
    fireEvent.change(screen.getByLabelText('CubeCobra cube link'), {
      target: { value: 'https://cubecobra.com/cube/overview/legacy-cube' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => screen.getByRole('button', { name: 'Try again' }));
  });
});
