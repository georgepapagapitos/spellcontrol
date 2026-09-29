// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// E175 — sideboard/considering rows edit their count the same way as the
// mainboard (tap the number, type, Enter), wired through the host's single
// zone-aware `onSetQty(zone, ...)`. There is no −/+ stepper on any row.

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

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

/** Tap the row's count, type a new one, and press Enter. */
function editQty(value: string) {
  const btn = document.body.querySelector<HTMLButtonElement>('.deck-row-qty-edit');
  expect(btn).not.toBeNull();
  fireEvent.click(btn!);
  const input = document.body.querySelector<HTMLInputElement>('.deck-row-qty-input')!;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('DeckDisplay zone-aware qty edit (E175)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('edits a sideboard row and reports the sideboard zone', () => {
    const onSetQty = vi.fn();
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="standard"
          cards={[]}
          sideboard={copies(2)}
          onSetQty={onSetQty}
        />
      </MemoryRouter>
    );

    editQty('3');
    expect(onSetQty).toHaveBeenCalledTimes(1);
    expect(onSetQty).toHaveBeenCalledWith(
      'sideboard',
      expect.objectContaining({ id: 'sf-bolt' }),
      3,
      undefined
    );
  });

  it('edits a considering row in a singleton format and reports the considering zone', () => {
    const onSetQty = vi.fn();
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="commander"
          cards={[]}
          sideboard={[]}
          considering={copies(2)}
          onSetQty={onSetQty}
        />
      </MemoryRouter>
    );

    editQty('1');
    expect(onSetQty).toHaveBeenCalledWith(
      'considering',
      expect.objectContaining({ id: 'sf-bolt' }),
      1,
      undefined
    );
  });

  it('renders no −/+ stepper in any zone', () => {
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="standard"
          cards={copies(2)}
          sideboard={copies(2)}
          considering={copies(2)}
          onSetQty={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(document.body.querySelectorAll('.deck-row-qty-edit').length).toBeGreaterThanOrEqual(2);
    expect(document.body.querySelector('[aria-label^="Add one copy of"]')).toBeNull();
    expect(document.body.querySelector('[aria-label^="Remove one copy of"]')).toBeNull();
  });
});
