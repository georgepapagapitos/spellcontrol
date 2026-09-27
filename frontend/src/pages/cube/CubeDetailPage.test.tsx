// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCubeStore, type SavedCube } from '../../store/cube';
import { useCollectionStore } from '../../store/collection';
import type { GeneratedCube } from '../../lib/cube/generate';

vi.mock('../../deck-builder/services/scryfall/client', () => ({
  getCardsByNames: vi.fn(() => Promise.resolve(new Map())),
}));

import { CubeDetailPage } from './CubeDetailPage';

function makeCube(size: 180 | 360 = 180): GeneratedCube {
  return {
    size,
    format: 'limited',
    picks: [],
    byBucket: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 },
    targetByBucket: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 },
    gaps: [],
    shortfall: 0,
    poolSize: 0,
  };
}

function saved(over: Partial<SavedCube> = {}): SavedCube {
  return {
    id: 'cube-1',
    name: 'Vintage 540',
    size: 180,
    cube: makeCube(180),
    picks: [],
    isPhysical: false,
    savedAt: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [] });
  useCollectionStore.setState({ cards: [], binders: [], hydrating: false });
  localStorage.clear();
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

describe('CubeDetailPage — found', () => {
  it('renders the header with the cube name and Cards tab by default', async () => {
    useCubeStore.setState({ saved: [saved({ id: 'x', name: 'My Draft Cube' })] });
    renderAt('/decks/cube/x');
    // The title is now an in-place rename control (STYLE_GUIDE § Verbs —
    // Rename) — a button naming the cube — but a heading's accessible name
    // is computed from its rendered text, not a nested control's aria-label,
    // so the heading itself still reads as the plain cube name.
    expect(screen.getByRole('heading', { name: 'My Draft Cube' })).toBeTruthy();
    const cardsTab = screen.getByRole('tab', { name: 'Cards' });
    expect(cardsTab.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(screen.getByText('Color balance')).toBeTruthy());
  });

  it('switches to the Shopping list and Pull list tabs', () => {
    useCubeStore.setState({ saved: [saved({ id: 'x' })] });
    renderAt('/decks/cube/x');
    // CubeShoppingList.test.tsx covers the Shopping list tab's own states
    // (loading/empty/error/ready) with proper cube-signal/oracle mocks; here
    // only the tab switch itself is under test.
    fireEvent.click(screen.getByRole('tab', { name: 'Shopping list' }));
    expect(screen.getByRole('tab', { name: 'Shopping list' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Pull list by binder' }));
    expect(screen.getByText('Mark this cube physical first.')).toBeTruthy();
  });

  it('a physical cube renders the real pull list (CubePullList), not the placeholder', () => {
    useCubeStore.setState({ saved: [saved({ id: 'x', isPhysical: true })] });
    renderAt('/decks/cube/x');
    fireEvent.click(screen.getByRole('tab', { name: 'Pull list by binder' }));
    expect(screen.getByText('0 of 0 located')).toBeTruthy();
    expect(screen.queryByText('Not built yet.')).toBeNull();
  });
});

describe('CubeDetailPage — not found', () => {
  it('shows a not-found state with a way back, never a crash', () => {
    renderAt('/decks/cube/does-not-exist');
    expect(screen.getByText(/doesn't exist/)).toBeTruthy();
    const back = screen.getByRole('link', { name: /Back to cubes/ });
    expect(back.getAttribute('href')).toBe('/decks/cube');
  });
});

describe('CubeDetailPage — rename (STYLE_GUIDE § Verbs — Rename)', () => {
  it('renames in place on the title: Enter saves', async () => {
    useCubeStore.setState({ saved: [saved({ id: 'x', name: 'My Draft Cube' })] });
    renderAt('/decks/cube/x');

    fireEvent.click(screen.getByRole('button', { name: 'Rename My Draft Cube' }));
    const input = screen.getByLabelText('Cube name');
    fireEvent.change(input, { target: { value: 'Renamed cube' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(useCubeStore.getState().saved.find((c) => c.id === 'x')?.name).toBe('Renamed cube')
    );
  });

  it('Escape reverts without renaming', () => {
    useCubeStore.setState({ saved: [saved({ id: 'x', name: 'My Draft Cube' })] });
    renderAt('/decks/cube/x');

    fireEvent.click(screen.getByRole('button', { name: 'Rename My Draft Cube' }));
    const input = screen.getByLabelText('Cube name');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(useCubeStore.getState().saved.find((c) => c.id === 'x')?.name).toBe('My Draft Cube');
    expect(screen.getByRole('button', { name: 'Rename My Draft Cube' })).toBeTruthy();
  });

  it('the header Rename menu item opens the title in edit mode, no modal', () => {
    useCubeStore.setState({ saved: [saved({ id: 'x', name: 'My Draft Cube' })] });
    renderAt('/decks/cube/x');

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Cube name')).toBeTruthy();
  });
});
