// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// Per-printing expand: a row whose copies span >1 printing (e.g. special-art
// basics) gets a disclosure that reveals one sub-row per distinct printing.

function mountain(over: Partial<ScryfallCard>): ScryfallCard {
  return {
    oracle_id: 'o-mountain',
    name: 'Mountain',
    mana_cost: '',
    cmc: 0,
    type_line: 'Basic Land — Mountain',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    ...over,
  } as ScryfallCard;
}

/** N slots of one specific printing. */
function copies(card: ScryfallCard, qty: number): DeckDisplayCard[] {
  return Array.from({ length: qty }, (_, i) => ({ slotId: `${card.id}-${i}`, card }));
}

function renderDeck(cards: DeckDisplayCard[]) {
  return render(
    <MemoryRouter>
      <DeckDisplay title="Test deck" commander={null} cards={cards} />
    </MemoryRouter>
  );
}

describe('DeckDisplay per-printing expand', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('shows a disclosure and reveals one sub-row per printing for a multi-printing stack', () => {
    const cards = [
      ...copies(mountain({ id: 'sf-2418', set: 'sld', collector_number: '2418' }), 7),
      ...copies(mountain({ id: 'sf-2419', set: 'sld', collector_number: '2419' }), 7),
      ...copies(mountain({ id: 'sf-2420', set: 'sld', collector_number: '2420' }), 8),
    ];
    const { container } = renderDeck(cards);

    // Single aggregated row, count 22, with a "3 printings" toggle.
    const toggle = container.querySelector<HTMLButtonElement>('.deck-row-printings-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toContain('3 printings');
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    // Collapsed: no sub-rows yet.
    expect(container.querySelectorAll('.deck-printing-sub')).toHaveLength(0);

    fireEvent.click(toggle!);

    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    const subs = container.querySelectorAll('.deck-printing-sub');
    expect(subs).toHaveLength(3);
    // Largest stack first (qty desc): #2420 (8), then #2418/#2419 (7).
    const sets = Array.from(subs).map((s) => s.querySelector('.deck-printing-sub-cn')?.textContent);
    expect(sets).toEqual([' · #2420', ' · #2418', ' · #2419']);
    // Per-printing counts sum back to the aggregate.
    const qtys = Array.from(subs).map((s) =>
      Number(s.querySelector('.deck-printing-sub-qty')?.textContent)
    );
    expect(qtys).toEqual([8, 7, 7]);
    expect(qtys.reduce((a, b) => a + b, 0)).toBe(22);
  });

  it('shows no disclosure for a uniform single-printing stack', () => {
    const { container } = renderDeck(
      copies(mountain({ id: 'sf-2418', set: 'sld', collector_number: '2418' }), 12)
    );
    expect(container.querySelector('.deck-row-printings-toggle')).toBeNull();
    expect(container.querySelectorAll('.deck-printing-sub')).toHaveLength(0);
  });
});
