// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SharedCardList } from './SharedCardList';
import type { PublicCard } from '../../lib/shared-types';
import { SHARED_TABLE_COLUMNS } from '../shared/CardTable';

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

function stubViewport(tabletOrWider: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width:\s*768px/.test(query) ? tabletOrWider : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function pc(over: Partial<PublicCard> = {}): PublicCard {
  return {
    name: 'Sol Ring',
    oracleId: 'o-sol',
    scryfallId: 'sf-sol',
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '472',
    rarity: 'uncommon',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 3.5,
    cmc: 1,
    typeLine: 'Artifact',
    colors: [],
    colorIdentity: [],
    ...over,
  } as PublicCard;
}

function renderList(props: Partial<React.ComponentProps<typeof SharedCardList>> = {}) {
  return render(
    <MemoryRouter>
      <SharedCardList
        items={[{ key: 'a', card: pc(), quantity: 2 }]}
        onPreview={() => {}}
        {...props}
      />
    </MemoryRouter>
  );
}

describe('SharedCardList', () => {
  it('renders the app-wide CardRow, not its own table', () => {
    // The point of the component: an adapter over `CardRow`, so a shared or
    // friend list view matches the owner's collection. A reintroduced
    // <table> here is the drift this replaced.
    const { container } = renderList();
    expect(container.querySelector('.collection-list-row')).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
  });

  it('opens the preview at the clicked row index', () => {
    const onPreview = vi.fn();
    renderList({
      items: [
        { key: 'a', card: pc({ name: 'Sol Ring' }), quantity: 1 },
        { key: 'b', card: pc({ name: 'Mana Crypt' }), quantity: 1 },
      ],
      onPreview,
    });
    fireEvent.click(screen.getByRole('button', { name: /mana crypt/i }));
    expect(onPreview).toHaveBeenCalledWith(1);
  });

  it('showPrice/showQty false say nothing about value or count', () => {
    // The friend-collection contract, carried through to the list view.
    const { container } = renderList({
      items: [
        { key: 'a', card: pc({ purchasePrice: 0, setCode: '', collectorNumber: '' }), quantity: 4 },
      ],
      showPrice: false,
      showQty: false,
    });
    expect(container.textContent).not.toMatch(/\$/);
    expect(container.textContent).not.toMatch(/×4|\b4\b/);
  });

  it('keeps the ownership fact in the row’s accessible name', () => {
    // The old table put it in a per-row aria-label. CardRow has no aria-label
    // — its name is its content — and the owned dot is aria-hidden, so the
    // fact needs a real text node or it silently disappears for a screen
    // reader (entirely, for a card owned in no binder).
    renderList({
      items: [{ key: 'a', card: pc(), quantity: 1, ownership: { owned: true, binders: [] } }],
    });
    expect(screen.getByRole('button', { name: /sol ring.*owned/i })).toBeTruthy();
  });
});

/**
 * The compact mode these surfaces gained: the same table an owner sees on
 * their own Collection, minus the columns a shared projection has no business
 * carrying — condition, language and notes are the owner's private
 * annotations, and there is no per-row menu because nothing here is the
 * viewer's to edit. Qty and Price stay column-shaped but still obey the
 * contents-yes-value-no contract.
 */
describe('SharedCardList in compact (table) mode', () => {
  it('renders the read-only column set, with no menu column', () => {
    stubViewport(true);
    const { container } = renderList({ table: true });
    const cols = [...container.querySelectorAll('.collection-table-head > [data-col]')].map((el) =>
      el.getAttribute('data-col')
    );
    expect(cols).toEqual([...SHARED_TABLE_COLUMNS]);
    for (const absent of ['cond', 'lang', 'notes', 'binder', 'menu']) {
      expect(cols, `${absent} has no place on someone else's collection`).not.toContain(absent);
    }
    // Header and row agree, which is what the shared column list buys.
    const rowCols = [...container.querySelectorAll('.collection-table-row > [data-col]')].map(
      (el) => el.getAttribute('data-col')
    );
    expect(rowCols).toEqual(cols);
  });

  it('drops the withheld columns rather than labelling empty ones', () => {
    // A friend's collection reports contents, not count or value. On a flow
    // row those simply don't render; a table would otherwise keep three
    // headed tracks promising numbers that never arrive.
    stubViewport(true);
    const { container } = renderList({ table: true, showPrice: false, showQty: false });
    const cols = [...container.querySelectorAll('.collection-table-head > [data-col]')].map((el) =>
      el.getAttribute('data-col')
    );
    expect(cols).toEqual(['name', 'set', 'cn', 'mana']);
    expect(container.textContent).not.toMatch(/\$/);
    expect(container.textContent).not.toMatch(/Price|Total|Qty/);
  });

  it('falls back to the flow row below tablet width, where the columns do not fit', () => {
    stubViewport(false);
    const { container } = renderList({ table: true });
    expect(container.querySelector('.collection-table-head')).toBeNull();
    expect(container.querySelector('.collection-table-row')).toBeNull();
  });
});
