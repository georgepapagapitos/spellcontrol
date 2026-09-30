// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ArrivalsByType } from '@/lib/coach/new-arrivals';
import { DeckDisplay } from './DeckDisplay';

// Home's "+N new cards" badge used to open the deck and stop there, so the N
// cards were nowhere on screen. It lands on `?arrivals=1`, and the page asks
// DeckDisplay to open the new-arrivals sheet once its rows have loaded.

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

const card = {
  id: 'sf-1',
  oracle_id: 'o-1',
  name: 'Test Creature',
  cmc: 3,
  type_line: 'Creature — Beast',
  color_identity: ['G'],
  keywords: [],
  rarity: 'common',
  set: 'tst',
  set_name: 'Test Set',
  prices: {},
} as unknown as ScryfallCard;

const arrivals: ArrivalsByType = {
  Creature: [
    {
      name: 'Eternal Witness',
      card: { name: 'Eternal Witness', typeLine: 'Creature — Human Shaman', colorIdentity: ['G'] },
      qty: 1,
      score: 1,
    },
  ],
};

function renderDeck(props: { arrivalsByType?: ArrivalsByType; autoOpenArrivals?: boolean }) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        cards={[{ slotId: 'slot-1', card }]}
        onMarkArrivalsReviewed={() => {}}
        {...props}
      />
    </MemoryRouter>
  );
}

describe('DeckDisplay opens the new-arrivals sheet from a deep link', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('opens the sheet with the arrivals in it', () => {
    renderDeck({ arrivalsByType: arrivals, autoOpenArrivals: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('Eternal Witness').length).toBeGreaterThan(0);
  });

  it('waits for rows before opening, since the sheet freezes them', () => {
    const { rerender } = renderDeck({ arrivalsByType: {}, autoOpenArrivals: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          cards={[{ slotId: 'slot-1', card }]}
          onMarkArrivalsReviewed={() => {}}
          arrivalsByType={arrivals}
          autoOpenArrivals
        />
      </MemoryRouter>
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('stays closed on a normal visit', () => {
    renderDeck({ arrivalsByType: arrivals });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
