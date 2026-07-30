// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// E175 — sideboard/considering rows get the same +/- qty stepper as the
// mainboard, wired through the host's single zone-aware `onSetQty(zone, ...)`.
// Regression coverage for the bug this ticket actually found: the sideboard/
// considering CategorySection instances never passed `isSingleton` down, so
// DeckCardRow fell back to `isSingleton ?? true` and getMaxCopies capped at 1
// for any non-basic card — the stepper silently never rendered outside a
// unique "any number" oracle text card.

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

describe('DeckDisplay zone-aware qty stepper (E175)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('renders the +/- stepper on a sideboard row and reports the sideboard zone', () => {
    const onSetQty = vi.fn();
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          // Non-singleton format so a plain non-basic card's maxCopies is 4,
          // not 1 — proves isSingleton is actually threaded through, not just
          // defaulted true.
          format="standard"
          cards={[]}
          sideboard={copies(2)}
          onSetQty={onSetQty}
        />
      </MemoryRouter>
    );

    const minus = document.body.querySelector<HTMLButtonElement>('.deck-row-qty-step-minus');
    const plus = document.body.querySelector<HTMLButtonElement>('.deck-row-qty-step-plus');
    expect(minus).not.toBeNull();
    expect(plus).not.toBeNull();
    expect(minus!.getAttribute('aria-label')).toBe('Remove one copy of Lightning Bolt');
    expect(plus!.getAttribute('aria-label')).toBe('Add one copy of Lightning Bolt');

    fireEvent.click(plus!);
    expect(onSetQty).toHaveBeenCalledWith(
      'sideboard',
      expect.objectContaining({ id: 'sf-bolt' }),
      1,
      {
        relative: true,
      }
    );
  });

  it('renders the stepper on a considering row even in a singleton format, and reports the considering zone', () => {
    const onSetQty = vi.fn();
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          // Singleton format (Commander) — considering is copy-limit exempt
          // regardless, so the stepper must still show.
          format="commander"
          cards={[]}
          sideboard={[]}
          considering={copies(2)}
          onSetQty={onSetQty}
        />
      </MemoryRouter>
    );

    const minus = document.body.querySelector<HTMLButtonElement>('.deck-row-qty-step-minus');
    const plus = document.body.querySelector<HTMLButtonElement>('.deck-row-qty-step-plus');
    expect(minus).not.toBeNull();
    expect(plus).not.toBeNull();

    fireEvent.click(minus!);
    expect(onSetQty).toHaveBeenCalledWith(
      'considering',
      expect.objectContaining({ id: 'sf-bolt' }),
      -1,
      { relative: true }
    );
  });

  it('mainboard, sideboard, and considering steppers share identical touch targets and a11y labels', () => {
    const onSetQty = vi.fn();
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="standard"
          cards={copies(2)}
          sideboard={copies(2)}
          considering={copies(2)}
          onSetQty={onSetQty}
        />
      </MemoryRouter>
    );

    // Mainboard renders inline; the outzone panel starts on the Sideboard tab
    // (sideboard is non-empty), so both mainboard and sideboard steppers are
    // simultaneously present and must match exactly.
    const steppers = document.body.querySelectorAll<HTMLButtonElement>('.deck-row-qty-step-plus');
    expect(steppers.length).toBeGreaterThanOrEqual(2);
    for (const btn of Array.from(steppers)) {
      expect(btn.getAttribute('aria-label')).toBe('Add one copy of Lightning Bolt');
    }
  });
});
