// @vitest-environment happy-dom
/**
 * E472 — one word for the physical work, and a way back from paused rules.
 *
 * The queue of cards to put in or take out of the real binder was "cards to
 * file" on Home, "N to review" on the index, "Since last reviewed" / "Mark
 * reviewed" on the binder and "Drift" in its tip. It is "to file" everywhere,
 * and the one-click check-off is "All filed" (a past-tense confirmation, the
 * review queue's own grammar). "Manual order" became "Custom order", because
 * manual is the binder MODE whose rules are paused; and that mode now says so
 * on the page, with the way back.
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sync', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/sync')>()),
  getSyncState: () => 'ready',
  hasSyncError: () => false,
  onSyncedChange: () => () => {},
}));

import { BinderPage } from './BinderPage';
import { BindersIndexPage } from './BindersIndexPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { useToastsStore } from '../store/toasts';
import { printingFinishKey } from '@/lib/collection/collection-mutations';
import type { BinderDef, EnrichedCard } from '../types';

function card(n: number, rarity: string): EnrichedCard {
  return {
    copyId: `c${n}`,
    scryfallId: `s${n}`,
    oracleId: `o${n}`,
    name: `Card ${n}`,
    setCode: 'TST',
    collectorNumber: String(n),
    rarity,
    purchasePrice: 1,
    finish: 'nonfoil',
    typeLine: 'Instant',
  } as unknown as EnrichedCard;
}

const rares = { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } };
const old = card(1, 'rare');
const arrived = card(2, 'rare');
const common = card(3, 'common');

function binder(over: Partial<BinderDef>): BinderDef {
  return {
    id: 'b-rares',
    name: 'Rares',
    position: 0,
    filterGroups: [{ filter: rares }],
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

// Reviewed when it held only `old`; `arrived` has filed in since.
const reviewed = binder({
  lastReviewedSnapshot: {
    at: Date.now() - 60_000,
    keys: [printingFinishKey(old)],
    cardSnapshots: {},
  },
});

function renderPage(id: string) {
  render(
    <MemoryRouter initialEntries={[`/collection/binders/${id}`]}>
      <Routes>
        <Route path="/collection/binders/:id" element={<BinderPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'guest' });
  useToastsStore.setState({ toasts: [] });
  useCollectionStore.setState({
    hydrating: false,
    cards: [old, arrived, common],
    binders: [reviewed],
    activeTab: 'b-rares',
    importHistory: [],
  });
});
afterEach(cleanup);

describe('the filing queue says "to file" everywhere', () => {
  it('on the binder: To file, All filed, no "review" or "Drift"', () => {
    localStorage.setItem('mtg-binder-view-mode', 'list');
    renderPage('b-rares');
    expect(screen.getByText('To file')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All filed' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Since last reviewed|Mark reviewed|Drift/);
  });

  it('on the index: the chip reads "N to file", like Home', () => {
    render(
      <MemoryRouter initialEntries={['/collection/binders']}>
        <BindersIndexPage />
      </MemoryRouter>
    );
    expect(screen.getByText('1 to file')).toBeTruthy();
    expect(screen.queryByText(/to review/)).toBeNull();
  });
});

describe('a binder whose rules are paused says so, and offers the way back', () => {
  it('counts what the rules would bring in, and switches back with Undo', () => {
    useCollectionStore.setState({
      binders: [binder({ mode: 'manual', pinnedCopyIds: ['c1'] })],
    });
    renderPage('b-rares');
    expect(screen.getByText('Rules paused')).toBeTruthy();
    // The rules file both rares here (c1 is also pinned, and pins stay).
    expect(screen.getByText(/Its rules would file 2 cards here/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to rules' }));
    expect(useCollectionStore.getState().binders[0].mode).toBe('rules');
    const t = useToastsStore.getState().toasts.at(-1);
    expect(t?.message).toBe('Rares files by its rules again');
    t?.onAction?.();
    expect(useCollectionStore.getState().binders[0].mode).toBe('manual');
  });

  it('says nothing for a binder on its rules', () => {
    renderPage('b-rares');
    expect(screen.queryByText('Rules paused')).toBeNull();
  });
});

describe('the order a user drags is a "Custom order"', () => {
  it('is named Custom order on the page, not Manual order', () => {
    useCollectionStore.setState({ binders: [binder({ manualOrder: ['c2', 'c1'] })] });
    renderPage('b-rares');
    expect(screen.getByText('Custom order')).toBeTruthy();
    expect(screen.queryByText(/Manual order/)).toBeNull();
  });
});
