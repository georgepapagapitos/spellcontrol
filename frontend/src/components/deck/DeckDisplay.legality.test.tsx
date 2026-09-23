// @vitest-environment happy-dom
// A bracket describes a legal deck. Commander Spellbook marks a deck with a
// banned card "B" (the Mystic Intellect precon's Dockside Extortionist); the
// Bracket panel leads with the same fact instead of showing a bracket alone.

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

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

const ESTIMATION: BracketEstimation = {
  bracket: 2,
  label: 'Core',
  hardFloors: [],
  softScore: 20,
  breakdown: {
    gameChangerCount: 0,
    gameChangerNames: [],
    massLandDenialCount: 0,
    massLandDenialNames: [],
    extraTurnCount: 0,
    extraTurnNames: [],
    twoCardComboCount: 0,
    multiCardComboCount: 0,
    fastManaCount: 0,
    fastManaNames: [],
    tutorCount: 0,
    tutorNames: [],
    staxPieceCount: 0,
    staxPieceNames: [],
    averageCmc: 3,
    interactionCount: 5,
  },
};

function renderPower(cards: ScryfallCard[]) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={mkCard({ name: 'Sevinne, the Chronoclasm', type_line: 'Legendary Creature' })}
        cards={cards.map((card): DeckDisplayCard => ({ slotId: `slot-${card.id}`, card }))}
        deckId="deck-1"
        format="commander"
        activeView="power"
        analysisState="ready"
        bracketEstimation={ESTIMATION}
      />
    </MemoryRouter>
  );
}

describe('Bracket panel legality note', () => {
  it('leads with a banned card', () => {
    renderPower([
      mkCard(),
      mkCard({ name: 'Dockside Extortionist', legalities: { commander: 'banned' } }),
    ]);
    expect(screen.getByRole('note').textContent).toBe(
      "Dockside Extortionist isn't legal in Commander. The deck can't be played at any bracket until it is cut."
    );
  });

  it('says nothing when every card is legal', () => {
    renderPower([mkCard(), mkCard()]);
    expect(screen.queryByText(/legal in Commander/)).toBeNull();
  });
});
