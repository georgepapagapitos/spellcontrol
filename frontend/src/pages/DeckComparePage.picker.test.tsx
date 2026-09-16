// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The /decks/compare picker must distinguish same-named decks.
 *
 * Playtest batch 5: the picker listed the dev account's ten decks as
 * "Abigale, Urianger Augurelt, Krenko, Abigale, Abigale, Krenko, Abigale,
 * Thassa, Thassa, Thassa" — by name only. You could not tell which deck you
 * were selecting on the page whose entire job is selecting two decks, and the
 * result header ("Abigale vs Krenko") could not tell you afterwards either.
 *
 * This is the normal case, not dirty data: generation names a deck after its
 * commander, so building two Krenko decks is what using the feature twice
 * produces.
 *
 * Note the commander is deliberately NOT the discriminator — same-named decks
 * all share it. Size and edited-time are what differ.
 */

vi.mock('@/lib/deck-diff', () => ({ diffDecks: () => null }));

import { DeckComparePage } from './DeckComparePage';
import { useDecksStore } from '../store/decks';

const DAY = 86_400_000;
function deck(id: string, name: string, cards: number, updatedAt: number) {
  return {
    id,
    name,
    format: 'commander',
    cards: Array.from({ length: cards }, (_, i) => ({ card: { name: `c${i}` }, quantity: 1 })),
    updatedAt,
    createdAt: updatedAt,
  };
}

beforeEach(() => {
  useDecksStore.setState({
    decks: [
      deck('d1', 'Abigale', 99, Date.now() - 3 * DAY),
      deck('d2', 'Abigale', 60, Date.now() - 40 * DAY),
    ] as never,
  });
});

describe('/decks/compare picker rows', () => {
  it('carries a size + edited line, so two decks named the same are tellable apart', () => {
    render(
      <MemoryRouter initialEntries={['/decks/compare']}>
        <DeckComparePage />
      </MemoryRouter>
    );
    // `itemLabel` renders only inside the popover, so open it first — that is
    // the whole point of the slot (the closed trigger stays a bare name).
    // The trigger's accessible name is its aria-label ("Deck A"), not its text.
    fireEvent.click(screen.getByRole('button', { name: /deck a/i }));

    // Both decks are named "Abigale"; the meta line is what separates them.
    expect(screen.getAllByText(/99 cards · Edited/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/60 cards · Edited/).length).toBeGreaterThan(0);
  });
});
