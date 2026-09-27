// @vitest-environment happy-dom
/**
 * T157 — a single-item delete is undoable from the toast, so it no longer
 * confirms first. Deleting the cube you're looking at from its own ⋮ menu
 * calls the real `removeSaved` store action directly (no ConfirmDialog
 * step), and the toast offers Undo.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCubeStore, type SavedCube } from '../../store/cube';
import { useCollectionStore } from '../../store/collection';
import { useToastsStore } from '../../store/toasts';
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
    name: 'Solo Cube',
    size: 180,
    cube: makeCube(180),
    picks: [],
    isPhysical: false,
    savedAt: Date.now(),
    ...over,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/decks/cube" element={<div>CUBE INDEX</div>} />
        <Route path="/decks/cube/:id" element={<CubeDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CubeDetailPage — single delete has no confirm (T157)', () => {
  beforeEach(() => {
    localStorage.clear();
    useToastsStore.setState({ toasts: [] });
    useCollectionStore.setState({ cards: [], binders: [], hydrating: false });
    useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [saved({ id: 'x' })] });
  });

  it('calls removeSaved directly from the ⋮ menu, with no confirm dialog, and toasts Undo', () => {
    renderAt('/decks/cube/x');

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(useCubeStore.getState().saved).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    const toast = useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');
    expect(toast?.message).toBe('Deleted Solo Cube');
    // Lands on the cube list, not on "Cube not found" for what it just removed.
    expect(screen.getByText('CUBE INDEX')).toBeTruthy();
  });
});
