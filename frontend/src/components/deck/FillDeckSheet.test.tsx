// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../../store/decks';

const buildFill = vi.fn();
vi.mock('@/lib/fill-deck', () => ({ buildFill: (...a: unknown[]) => buildFill(...a) }));
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { FillDeckSheet } from './FillDeckSheet';

const card = (name: string, type_line: string) => ({ name, type_line }) as ScryfallCard;
const deck = {
  id: 'd1',
  name: 'Goblins',
  commander: card('Krenko, Mob Boss', 'Legendary Creature — Goblin Warrior'),
  partnerCommander: null,
  cards: [{ card: card('Skirk Prospector', 'Creature — Goblin'), slotId: 's1' }],
} as unknown as Deck;

function renderSheet(onAdd = vi.fn()) {
  render(
    <FillDeckSheet
      deck={deck}
      target={4}
      ownedNames={new Set(['Goblin Bombardment'])}
      onClose={vi.fn()}
      onAdd={onAdd}
    />
  );
  return onAdd;
}

// Braces matter: a function returned from beforeEach runs as a teardown hook,
// and mockReset() returns the mock itself.
beforeEach(() => {
  buildFill.mockReset();
});

describe('FillDeckSheet', () => {
  it('asks how to lean, builds, then lists the cards with their reasons before adding', async () => {
    const additions = [
      card('Goblin Bombardment', 'Enchantment'),
      card('Goblin Chieftain', 'Creature — Goblin'),
      card('Mountain', 'Basic Land — Mountain'),
    ];
    buildFill.mockResolvedValue({
      plan: { additions, stillOpen: 0 },
      reasons: { 'Goblin Chieftain': 'EDHREC staple for this commander' },
      notes: [],
    });
    const onAdd = renderSheet();

    expect(screen.getByText('3 open slots · 1 of 4 cards picked')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Synergy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Find 3 cards' }));

    await waitFor(() => screen.getByRole('button', { name: /Add 3 cards/ }));
    expect(buildFill.mock.calls[0][2]).toEqual({ brewLevel: 1, preferOwned: true });
    expect(screen.getByRole('region', { name: 'Creatures' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Lands' })).toBeTruthy();
    expect(screen.getByText('EDHREC staple for this commander')).toBeTruthy();
    // Nothing is added until the player confirms.
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Add 3 cards/ }));
    expect(onAdd).toHaveBeenCalledWith(additions);
  });

  it('says so, and offers another try, when the build fails', async () => {
    buildFill.mockRejectedValue(new Error('EDHREC is down'));
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Find 3 cards' }));
    expect((await screen.findByRole('alert')).textContent).toBe('EDHREC is down');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('owns up to slots it could not fill', async () => {
    buildFill.mockResolvedValue({
      plan: { additions: [card('Goblin Chieftain', 'Creature — Goblin')], stillOpen: 2 },
      reasons: {},
      notes: [],
    });
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Find 3 cards' }));
    await waitFor(() => screen.getByText('2 slots stay open: the card pool ran out.'));
  });
});
