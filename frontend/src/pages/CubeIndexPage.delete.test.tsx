// @vitest-environment happy-dom
/**
 * T157 — a single-item delete is undoable from the toast, so it no longer
 * confirms first. Deleting one cube from /decks/cube calls the real
 * `removeSaved` store action directly (no ConfirmDialog step), and the toast
 * it shows offers Undo.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCubeStore, type SavedCube } from '../store/cube';
import { useToastsStore } from '../store/toasts';
import type { GeneratedCube } from '../lib/cube/generate';
import { CubeIndexPage } from './CubeIndexPage';

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

function renderPage() {
  return render(
    <MemoryRouter>
      <CubeIndexPage />
    </MemoryRouter>
  );
}

describe('CubeIndexPage — single delete has no confirm (T157)', () => {
  beforeEach(() => {
    localStorage.clear();
    useToastsStore.setState({ toasts: [] });
    useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [saved()] });
  });

  it('calls removeSaved directly from the row menu, with no confirm dialog, and toasts Undo', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Solo Cube' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(useCubeStore.getState().saved).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    const toast = useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');
    expect(toast?.message).toBe('Deleted Solo Cube');
  });
});
