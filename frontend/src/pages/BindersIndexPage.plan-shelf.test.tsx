// @vitest-environment happy-dom
/**
 * E496 — the two BindersIndexPage entry points for "Plan a shelf": the
 * header ⋮ menu (once a collection exists) and the empty state's primary
 * button (cards imported, no binders yet). Also the `?planShelf=1` handoff
 * the chooser's lead tile uses (BinderStartChooser closes itself and
 * navigates here, since the planner lives one level up from that editor).
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { BindersIndexPage } from './BindersIndexPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import type { EnrichedCard } from '../types';

function card(name: string): EnrichedCard {
  return {
    copyId: name,
    scryfallId: `sf-${name}`,
    name,
    typeLine: 'Creature',
    colorIdentity: ['G'],
    rarity: 'common',
    purchasePrice: 1,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
  } as unknown as EnrichedCard;
}

function renderPage(initialEntries: string[] = ['/collection/binders']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <BindersIndexPage />
    </MemoryRouter>
  );
}

describe('BindersIndexPage — Plan a shelf entry points (E496)', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
  });

  it('offers "Plan a shelf" from the header menu once a collection exists', async () => {
    useCollectionStore.setState({ cards: [card('a'), card('b')], binders: [] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'More binder actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Plan a shelf' }));
    expect(await screen.findByText('Plan a shelf', { selector: 'h2' })).toBeTruthy();
  });

  it('hides the entry point entirely for an empty collection', () => {
    useCollectionStore.setState({ cards: [], binders: [] });
    renderPage();
    // No binders and no cards → the empty state has nothing to plan from,
    // and the header menu has no reason to offer it either.
    expect(screen.queryByRole('button', { name: 'More binder actions' })).toBeFalsy();
    expect(screen.queryByText('Plan a shelf')).toBeFalsy();
  });

  it('leads the "no binders yet, but I have cards" empty state', () => {
    useCollectionStore.setState({ cards: [card('a'), card('b')], binders: [] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Plan a shelf' }));
    expect(screen.getByText('Plan a shelf', { selector: 'h2' })).toBeTruthy();
  });

  it('opens from a ?planShelf=1 handoff and consumes the param', async () => {
    useCollectionStore.setState({ cards: [card('a'), card('b')], binders: [] });
    renderPage(['/collection/binders?planShelf=1']);
    expect(await screen.findByText('Plan a shelf', { selector: 'h2' })).toBeTruthy();
  });
});
