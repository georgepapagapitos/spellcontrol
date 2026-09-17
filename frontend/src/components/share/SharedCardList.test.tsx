// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SharedCardList } from './SharedCardList';
import type { PublicCard } from '../../lib/shared-types';

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

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
