// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UncategorizedSheet } from './UncategorizedSheet';
import { useCollectionStore } from '../store/collection';
import type { EnrichedCard } from '../types';

let n = 0;
function card(name: string, typeLine: string, colorIdentity: string[] = []): EnrichedCard {
  n += 1;
  return {
    copyId: `c${n}`,
    scryfallId: `sf${n}`,
    oracleId: `o-${name}`,
    name,
    typeLine,
    colorIdentity,
    colors: colorIdentity,
    rarity: 'common',
    purchasePrice: 0.2,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: String(n),
    quantity: 1,
  } as unknown as EnrichedCard;
}

const pile = [
  card('Forest', 'Basic Land — Forest'),
  card('Command Tower', 'Land'),
  card('Reliquary Tower', 'Land'),
  card('Llanowar Elves', 'Creature — Elf Druid', ['G']),
];

function renderSheet(cards = pile, onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <UncategorizedSheet cards={cards} onClose={onClose} />
    </MemoryRouter>
  );
  return onClose;
}

afterEach(() => {
  cleanup();
  useCollectionStore.setState({ editingBinder: null, editingBinderSeed: null });
});

describe('UncategorizedSheet', () => {
  it('names the pile and offers a binder for its biggest idea', () => {
    renderSheet();
    expect(screen.getByRole('heading', { name: '4 cards in no binder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Lands\s*3 of these cards/ })).toBeTruthy();
  });

  it('opens the rules editor filled in with the picked rule', () => {
    const onClose = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Lands/ }));
    const { editingBinder, editingBinderSeed } = useCollectionStore.getState();
    expect(onClose).toHaveBeenCalled();
    expect(editingBinder).toBe('new');
    expect(editingBinderSeed?.name).toBe('Lands');
    expect(editingBinderSeed?.groups?.[0].filter.typeTokenChips?.chips[0].value).toBe('land');
  });

  it('offers a catch-all with no rules for everything else', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Everything else/ }));
    const seed = useCollectionStore.getState().editingBinderSeed;
    expect(seed?.name).toBe('Everything else');
    expect(seed?.groups).toEqual([{ filter: {} }]);
  });

  it('still offers the catch-all when the pile is too small to split', () => {
    renderSheet(pile.slice(0, 1));
    expect(screen.getByRole('heading', { name: '1 card in no binder' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lands/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Everything else/ })).toBeTruthy();
  });

  it('links to the cards in the collection', () => {
    renderSheet();
    expect(screen.getByRole('link', { name: 'See the cards' }).getAttribute('href')).toBe(
      '/collection?binder=__uncategorized'
    );
  });
});
