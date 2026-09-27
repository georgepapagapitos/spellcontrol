// @vitest-environment happy-dom
/**
 * E471 — the cards no binder takes get a place on the Binders page: one tile
 * after every binder, counted from the same materialize pass as the binders,
 * that opens the suggestions sheet. It says nothing when every card has a
 * binder, and steps aside while the list is being searched.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { BindersIndexPage } from './BindersIndexPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import type { BinderDef, EnrichedCard } from '../types';

function card(copyId: string, rarity: string): EnrichedCard {
  return {
    copyId,
    scryfallId: `sf-${copyId}`,
    oracleId: `o-${copyId}`,
    name: `Card ${copyId}`,
    typeLine: 'Creature — Elf',
    colorIdentity: ['G'],
    colors: ['G'],
    rarity,
    purchasePrice: 0.5,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: copyId,
    quantity: 1,
  } as unknown as EnrichedCard;
}

const rares: BinderDef = {
  id: 'binder-rares',
  name: 'Rares',
  position: 0,
  filterGroups: [
    { filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } } },
  ],
  sorts: [],
  pocketSize: null,
  doubleSided: false,
  fixedCapacity: null,
  color: '#000',
  createdAt: 1,
  updatedAt: 1,
} as BinderDef;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/collection/binders']}>
      <BindersIndexPage />
    </MemoryRouter>
  );
}

describe('BindersIndexPage — the Uncategorized tile (E471)', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
    useCollectionStore.setState({
      cards: [card('1', 'rare'), card('2', 'common'), card('3', 'common')],
      binders: [rares],
      activeTab: 'binder-rares',
    });
  });

  it('counts the cards no binder takes, after the binders', () => {
    renderPage();
    const tile = screen.getByRole('button', { name: /Uncategorized\s*2 cards in no binder/ });
    const items = [...document.querySelectorAll('.binders-index-list > li')];
    expect(items.at(-1)?.contains(tile)).toBe(true);
  });

  it('opens the suggestions sheet', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Uncategorized/ }));
    expect(screen.getByRole('heading', { name: '2 cards in no binder' })).toBeTruthy();
  });

  it('says nothing when every card has a binder', () => {
    useCollectionStore.setState({ cards: [card('1', 'rare')] });
    renderPage();
    expect(screen.queryByRole('button', { name: /Uncategorized/ })).toBeNull();
  });

  it('steps aside while the binders are being searched', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('Search binders'), { target: { value: 'Rar' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Uncategorized/ })).toBeNull());
    expect(screen.getByText('Rares')).toBeTruthy();
  });
});
