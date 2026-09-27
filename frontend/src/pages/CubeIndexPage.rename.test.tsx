// @vitest-environment happy-dom
/**
 * T157 — a cube's row "Rename" menu item is a shortcut onto its own detail
 * page title (STYLE_GUIDE § Verbs — Rename), not a modal: it navigates to
 * the cube and puts the title straight into edit mode.
 */
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { useCubeStore, type SavedCube } from '../store/cube';
import { useCollectionStore } from '../store/collection';
import type { GeneratedCube } from '../lib/cube/generate';
import { CubeIndexPage } from './CubeIndexPage';
import { CubeDetailPage } from './cube/CubeDetailPage';

vi.mock('../deck-builder/services/scryfall/client', () => ({
  getCardsByNames: vi.fn(() => Promise.resolve(new Map())),
}));

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
  useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [saved()] });
  useCollectionStore.setState({ cards: [], binders: [], hydrating: false });
  localStorage.clear();
});

function renderPages() {
  return render(
    <MemoryRouter initialEntries={['/decks/cube']}>
      <Routes>
        <Route path="/decks/cube" element={<CubeIndexPage />} />
        <Route path="/decks/cube/:id" element={<CubeDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CubeIndexPage — row Rename opens the cube with its title in edit mode', () => {
  it('navigates to the detail page and opens the name field, no modal', async () => {
    renderPages();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Vintage 540' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Cube name')).toBeTruthy();
  });
});
