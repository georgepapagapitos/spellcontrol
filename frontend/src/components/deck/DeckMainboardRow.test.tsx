// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';
import { useCurrencyStore } from '../../lib/currency';

// DeckMainboardRow.tsx (CategorySection/DeckCardRow) is exercised through
// DeckDisplay — the same route DeckDisplay.qty-zone.test.tsx uses — rather
// than hand-built against the raw `Row` type directly (30+ derived fields:
// allocation counts, printing groups, image variants...). DeckDisplay's own
// row-building (deck-display-rows.ts) is what produces a real Row, so this
// is the shortest path to a row that actually reflects app behaviour.
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

function bolt(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
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
    prices: { usd: '3.50' },
    legalities: {},
    ...overrides,
  } as unknown as ScryfallCard;
}

function copies(qty: number, card: ScryfallCard = bolt()): DeckDisplayCard[] {
  // No `allocatedCopyId` — no collection is hydrated in this test, so every
  // slot classifies as unowned (the AllocationChip's "unowned" branch).
  return Array.from({ length: qty }, (_, i) => ({ slotId: `slot-${i}`, card }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mtg-decks-view-mode', 'list');
  // Pin currency — loadCurrency() falls back to the viewer's locale, which
  // would make the $7.00 assertion below machine-dependent otherwise.
  useCurrencyStore.setState({ currency: 'USD' });
});

function renderDeck(cards: DeckDisplayCard[], onSetQty = vi.fn()) {
  render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        format="standard"
        cards={cards}
        onSetQty={onSetQty}
      />
    </MemoryRouter>
  );
  return onSetQty;
}

describe('DeckMainboardRow (via DeckDisplay)', () => {
  it('renders the card name, quantity and price', () => {
    renderDeck(copies(2));

    // Scoped by selector — "Lightning Bolt" and "$7.00" also appear in the
    // deck's own missing-cards buy-list summary, not just the row.
    expect(screen.getByText('Lightning Bolt', { selector: '.deck-row-name-text' })).toBeTruthy();
    // qty renders in the +/- stepper's live chip (canEditQty + maxCopies>1).
    expect(document.querySelector('.deck-row-qty-edit')?.textContent).toBe('2');
    expect(screen.getByText('$7.00', { selector: '.deck-row-price' })).toBeTruthy(); // 2 × $3.50
  });

  it('shows the unowned allocation badge when no collection copy is allocated', () => {
    renderDeck(copies(1));

    // The text sits in the chip's own label element; the chip carries the state.
    const badge = screen.getByText('unowned').closest('.deck-row-alloc-chip')!;
    expect(badge.className).toContain('deck-row-alloc-chip-unowned');
    expect(badge.getAttribute('aria-label')).toBe('Not in your collection');
  });

  it('fires the qty-change callback with the mainboard zone when + is tapped', () => {
    const onSetQty = renderDeck(copies(2));

    fireEvent.click(screen.getByLabelText('Add one copy of Lightning Bolt'));

    expect(onSetQty).toHaveBeenCalledWith('cards', expect.objectContaining({ id: 'sf-bolt' }), 1, {
      relative: true,
    });
  });
});
