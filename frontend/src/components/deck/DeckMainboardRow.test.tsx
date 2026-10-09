// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';
import { useCurrencyStore } from '@/lib/collection/currency';

// DeckMainboardRow.tsx (CategorySection/DeckCardRow) is exercised through
// DeckDisplay — the same route DeckDisplay.qty-zone.test.tsx uses — rather
// than hand-built against the raw `Row` type directly (30+ derived fields:
// allocation counts, printing groups, image variants...). DeckDisplay's own
// row-building (deck-display-rows.ts) is what produces a real Row, so this
// is the shortest path to a row that actually reflects app behavior.
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

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
    // qty renders in the tap-to-edit button (canEditQty).
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

  it('fires the qty-change callback with the mainboard zone when the count is edited', () => {
    const onSetQty = renderDeck(copies(2));

    fireEvent.click(document.querySelector('.deck-row-qty-edit')!);
    const input = document.querySelector<HTMLInputElement>('.deck-row-qty-input')!;
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSetQty).toHaveBeenCalledTimes(1);
    expect(onSetQty).toHaveBeenCalledWith(
      'cards',
      expect.objectContaining({ id: 'sf-bolt' }),
      3,
      undefined
    );
  });

  it('commits a 0 once and hands focus to the next row before the row leaves', () => {
    const shock = bolt({ id: 'sf-shock', oracle_id: 'o-shock', name: 'Shock' });
    const onSetQty = renderDeck([...copies(1), ...copies(1, shock)]);

    const [first, second] = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.deck-row-qty-edit')
    );
    fireEvent.click(first);
    const input = document.querySelector<HTMLInputElement>('.deck-row-qty-input')!;
    input.focus();
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSetQty).toHaveBeenCalledTimes(1);
    expect(onSetQty).toHaveBeenCalledWith('cards', expect.anything(), 0, undefined);
    expect(document.activeElement).toBe(second);
  });

  // The rows that used to carry a −/+ stepper in a Commander list: a basic,
  // and a card whose own rules text allows any number of copies. The user
  // read the stepper on only those rows as a bug. Real oracle text, not an
  // author-written stand-in, so the "any number" branch is the real one.
  it.each([
    bolt({
      id: 'sf-island',
      oracle_id: 'o-island',
      name: 'Island',
      type_line: 'Basic Land — Island',
      mana_cost: '',
      oracle_text: '({T}: Add {U}.)',
    }),
    bolt({
      id: 'sf-approach',
      oracle_id: 'o-approach',
      name: "Sphinx's Approach",
      mana_cost: '{2}{U}{U}',
      oracle_text:
        "Draw two cards. Then you may exile this spell and four cards named Sphinx's Approach from your graveyard. If you do, search your library for a Sphinx creature card, put it onto the battlefield, then shuffle.\nA deck can have any number of cards named Sphinx's Approach.",
    }),
  ])('shows no −/+ stepper on $name in a Commander deck, only the editable count', (card) => {
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="commander"
          cards={copies(3, card)}
          onSetQty={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(document.querySelector('.deck-row-qty-edit')?.textContent).toBe('3');
    expect(screen.queryByLabelText(`Add one copy of ${card.name}`)).toBeNull();
    expect(screen.queryByLabelText(`Remove one copy of ${card.name}`)).toBeNull();
  });
});
