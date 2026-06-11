// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// T36 — per-card price in deck LIST rows, gated by the existing
// `showPrefs.price` preference (the same toggle that gates the section
// subtotals). Grid tiles intentionally show no price.

let idSeq = 0;
function mkCard(over: Partial<ScryfallCard> = {}): ScryfallCard {
  idSeq += 1;
  return {
    id: `sf-${idSeq}`,
    oracle_id: `o-${idSeq}`,
    name: 'Sol Ring',
    mana_cost: '{1}',
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'uncommon',
    set: 'tst',
    set_name: 'Test Set',
    prices: { usd: '3.20' },
    ...over,
  } as ScryfallCard;
}

function slots(card: ScryfallCard, qty: number): DeckDisplayCard[] {
  return Array.from({ length: qty }, (_, i) => ({ slotId: `slot-${card.name}-${i}`, card }));
}

function renderDeck(cards: DeckDisplayCard[]) {
  return render(
    <MemoryRouter>
      <DeckDisplay title="Test deck" commander={null} cards={cards} />
    </MemoryRouter>
  );
}

describe('DeckDisplay list-row price (T36)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('renders the aggregated row price when the price pref is on (default)', () => {
    const { container } = renderDeck(slots(mkCard(), 2));
    const cell = container.querySelector('.deck-row .deck-row-price');
    expect(cell).not.toBeNull();
    // qty 2 × $3.20 — the row aggregate, matching the section subtotals.
    expect(cell!.textContent).toBe('$6.40');
  });

  it('exposes the per-copy price as a title tooltip only when qty > 1', () => {
    const { container, unmount } = renderDeck(slots(mkCard(), 2));
    expect(container.querySelector('.deck-row .deck-row-price')!.getAttribute('title')).toBe(
      '$3.20 each'
    );
    unmount();

    const single = renderDeck(slots(mkCard(), 1));
    const cell = single.container.querySelector('.deck-row .deck-row-price')!;
    expect(cell.textContent).toBe('$3.20');
    expect(cell.getAttribute('title')).toBeNull();
  });

  it('renders an empty placeholder cell when the price is unknown, keeping columns aligned', () => {
    const { container } = renderDeck(slots(mkCard({ prices: {} }), 1));
    const cell = container.querySelector('.deck-row .deck-row-price');
    expect(cell).not.toBeNull();
    expect(cell!.textContent).toBe('');
    expect(cell!.getAttribute('aria-hidden')).toBe('true');
  });

  it('sits between the mana cost and the row menu', () => {
    const { container } = renderDeck(slots(mkCard(), 1));
    const cell = container.querySelector('.deck-row .deck-row-price')!;
    expect(cell.previousElementSibling?.classList.contains('mana-cost-row')).toBe(true);
    expect(cell.nextElementSibling?.classList.contains('deck-row-menu')).toBe(true);
  });

  it('hides the price cell when the price pref is off', () => {
    localStorage.setItem(
      'mtg-decks-show-prefs',
      JSON.stringify({ price: false, roles: true, mana: true })
    );
    const { container } = renderDeck(slots(mkCard(), 2));
    expect(container.querySelector('.deck-row')).not.toBeNull();
    expect(container.querySelector('.deck-row-price')).toBeNull();
  });
});
