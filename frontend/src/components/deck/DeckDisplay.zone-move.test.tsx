// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// Quantity-grouped rows move copies across zones. A stacked row offers both
// "move one copy" and "move all N copies"; a 1-of offers a single plain item.

function bolt(): ScryfallCard {
  return {
    id: 'sf-bolt',
    oracle_id: 'o-bolt',
    name: 'Lightning Bolt',
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Instant',
    color_identity: ['R'],
    keywords: [],
    rarity: 'common',
    set: 'lea',
    collector_number: '161',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    legalities: {},
  } as unknown as ScryfallCard;
}

function copies(qty: number): DeckDisplayCard[] {
  return Array.from({ length: qty }, (_, i) => ({ slotId: `slot-${i}`, card: bolt() }));
}

function renderDeck(cards: DeckDisplayCard[], onMoveToSideboard: (ids: string[]) => void) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        format="standard"
        cards={cards}
        onMoveToSideboard={onMoveToSideboard}
      />
    </MemoryRouter>
  );
}

/**
 * Open the row overflow menu and return its item buttons. The popover panel
 * portals to <body>, so the items are never under the render container.
 */
function openMenu(container: HTMLElement): HTMLButtonElement[] {
  const trigger = container.querySelector<HTMLButtonElement>('.deck-row-menu-trigger');
  expect(trigger).not.toBeNull();
  fireEvent.click(trigger!);
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('.deck-row-menu-item'));
}

const labels = (items: HTMLButtonElement[]) => items.map((b) => b.textContent);

describe('DeckDisplay zone moves', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('offers both one-copy and all-copies moves on a stacked row', () => {
    const onMove = vi.fn();
    const { container } = renderDeck(copies(4), onMove);

    expect(labels(openMenu(container))).toEqual(
      expect.arrayContaining(['Move one copy to sideboard', 'Move all 4 copies to sideboard'])
    );
  });

  it('"move all" hands back every slot id, "move one" just the first', () => {
    const onMove = vi.fn();
    const { container } = renderDeck(copies(4), onMove);
    const items = openMenu(container);

    fireEvent.click(items.find((b) => b.textContent === 'Move all 4 copies to sideboard')!);
    expect(onMove).toHaveBeenCalledWith(['slot-0', 'slot-1', 'slot-2', 'slot-3']);

    onMove.mockClear();
    fireEvent.click(
      openMenu(container).find((b) => b.textContent === 'Move one copy to sideboard')!
    );
    expect(onMove).toHaveBeenCalledWith(['slot-0']);
  });

  it('a single copy gets one plain move item, no all-copies variant', () => {
    const onMove = vi.fn();
    const { container } = renderDeck(copies(1), onMove);
    const found = labels(openMenu(container));

    expect(found).toContain('Move to sideboard');
    expect(found.some((l) => l?.startsWith('Move all'))).toBe(false);
  });
});
