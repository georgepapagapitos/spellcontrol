// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckCardInspector } from './DeckCardInspector';
import type { Row } from './deck-display-rows';

// A proxy slot reads as covered, so the inspector's ownership line is where it
// has to say "proxy" out loud, with the way back beside it.

const row = (over: Partial<Row>): Row =>
  ({
    name: 'Dryad of the Ilysian Grove',
    qty: 1,
    price: 0,
    slotIds: ['s1'],
    status: 'allocated',
    allocatedQty: 0,
    unownedQty: 0,
    orphanQty: 0,
    claimedElsewhereQty: 0,
    proxyQty: 1,
    card: { id: 'sf-dryad', name: 'Dryad of the Ilysian Grove' } as ScryfallCard,
    ...over,
  }) as Row;

function renderInspector(r: Row, onSetProxy = vi.fn()) {
  render(
    <MemoryRouter>
      <DeckCardInspector
        card={{ row: r, binders: [] }}
        currency="USD"
        pinned={false}
        onTogglePin={() => {}}
        actions={{ onSetProxy }}
      />
    </MemoryRouter>
  );
  return onSetProxy;
}

describe('DeckCardInspector: a proxy slot', () => {
  it('shows a proxy chip and the summary, and Not a proxy unmarks the row', () => {
    const onSetProxy = renderInspector(row({}));
    expect(screen.getByText('proxy')).toBeTruthy();
    expect(screen.getByText('Played as a proxy')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not a proxy' }));
    expect(onSetProxy).toHaveBeenCalledWith(['s1'], false);
  });

  it('names one copy on a stack', () => {
    renderInspector(row({ qty: 2, slotIds: ['s1', 's2'], allocatedQty: 1 }));
    expect(screen.getByRole('button', { name: 'Unmark one proxy' })).toBeTruthy();
  });

  it('shows neither for a card with no proxy', () => {
    renderInspector(row({ proxyQty: 0, allocatedQty: 1 }));
    expect(screen.queryByText('proxy')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not a proxy' })).toBeNull();
  });
});
