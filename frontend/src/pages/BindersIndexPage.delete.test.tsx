// @vitest-environment happy-dom
/**
 * T157 — a single-item delete is undoable from the toast, so it no longer
 * confirms first. Deleting one binder from /collection/binders calls the
 * real `deleteBinder` store action directly (no ConfirmDialog step), and the
 * toast it shows offers Undo and carries the "cards move elsewhere"
 * consequence the confirm dialog used to state.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { BindersIndexPage } from './BindersIndexPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { useToastsStore } from '../store/toasts';
import type { BinderDef } from '../types';

function makeBinder(over: Partial<BinderDef> = {}): BinderDef {
  return {
    id: 'binder-1',
    name: 'Solo Binder',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as BinderDef;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/collection/binders']}>
      <BindersIndexPage />
    </MemoryRouter>
  );
}

describe('BindersIndexPage — single delete has no confirm (T157)', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
    useToastsStore.setState({ toasts: [] });
    useCollectionStore.setState({
      cards: [],
      binders: [makeBinder()],
      activeTab: 'binder-1',
    });
  });

  it('calls deleteBinder directly from the row menu, with no confirm dialog, and toasts Undo with the consequence', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Solo Binder' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete binder' }));

    expect(useCollectionStore.getState().binders).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    const toast = useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');
    expect(toast?.message).toBe('Deleted Solo Binder. Its cards moved to other binders.');
  });
});
