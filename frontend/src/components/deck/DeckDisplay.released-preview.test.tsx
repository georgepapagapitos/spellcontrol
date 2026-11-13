// @vitest-environment happy-dom
// On Star Trek Commander's release day (2026-11-13) a TRC deck built the week
// before read "13 cards flagged in Commander": each card was stored while it
// was a preview, when Scryfall reads every card not_legal, and a deck keeps
// the copy it stored. The deck view asks the server for those cards' current
// legality, and a card it calls legal is not flagged.

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

const lookup = vi.hoisted(() => vi.fn<(names: string[]) => Promise<Map<string, ScryfallCard>>>());

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getBanList: vi.fn(async () => []),
  getCurrentCardsByName: lookup,
}));

let seq = 0;
function mkCard(over: Partial<ScryfallCard> = {}): ScryfallCard {
  seq += 1;
  return {
    id: `sf-${seq}`,
    oracle_id: `o-${seq}`,
    name: `Card ${seq}`,
    mana_cost: '{1}',
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  } as ScryfallCard;
}

// The stored preview copy, exactly as a deck holds it.
const storedDefiant = mkCard({
  name: 'U.S.S. Defiant, Tough Little Ship',
  set: 'trc',
  released_at: '2026-11-13',
  legalities: { commander: 'not_legal', vintage: 'not_legal' },
});
const unCard = mkCard({ name: 'Clown Car', legalities: { commander: 'not_legal' } });

function renderDeck(cards: ScryfallCard[]) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={mkCard({ name: 'Jean-Luc Picard, Luminary', type_line: 'Legendary Creature' })}
        cards={cards.map((card): DeckDisplayCard => ({ slotId: `slot-${card.id}`, card }))}
        deckId="deck-1"
        format="commander"
      />
    </MemoryRouter>
  );
}

describe('a card stored as a preview, after release', () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  it('is not flagged once the server calls it legal', async () => {
    lookup.mockResolvedValue(
      new Map([[storedDefiant.name, { ...storedDefiant, legalities: { commander: 'legal' } }]])
    );
    renderDeck([storedDefiant]);
    await waitFor(() => expect(lookup).toHaveBeenCalledWith([storedDefiant.name]));
    await waitFor(() => expect(screen.queryByText(/flagged in Commander/)).toBeNull());
  });

  it('stays flagged when the server still calls it not legal', async () => {
    lookup.mockResolvedValue(new Map([[unCard.name, unCard]]));
    renderDeck([unCard]);
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(await screen.findByText('1 card flagged in Commander')).toBeTruthy();
  });

  it('asks nothing when no stored card reads not legal', async () => {
    renderDeck([mkCard()]);
    await new Promise((r) => setTimeout(r, 0));
    expect(lookup).not.toHaveBeenCalled();
  });
});
