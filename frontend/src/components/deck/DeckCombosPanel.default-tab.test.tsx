// @vitest-environment happy-dom
/**
 * The Combos panel opens on the tab that has something in it. A deck with no
 * complete combo and seven one card away used to open on "No complete combos
 * in this deck", the seven one tap further. The owner's pick still wins.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComboMatch, ComboMatchResponse } from '../../types/combos';

const useDeckCombos = vi.fn();
vi.mock('../../lib/use-deck-combos', () => ({
  useDeckCombos: (args: unknown) => useDeckCombos(args),
}));
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('../CardPreview', () => ({ CardPreview: () => null }));
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => sel({ cards: [] }),
}));
vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks: [] }),
}));

import { DeckCombosPanel } from './DeckCombosPanel';

function match(id: string, names: [string, string], missing: boolean): ComboMatch {
  const cards = names.map((cardName, i) => ({ oracleId: `${id}-${i}`, cardName, quantity: 1 }));
  return {
    combo: {
      id,
      identity: 'r',
      produces: ['Infinite tokens'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 10,
      cardCount: 2,
      bracket: 3,
      cards,
    },
    presentOracleIds: missing ? [cards[0].oracleId] : cards.map((c) => c.oracleId),
    missingOracleIds: missing ? [cards[1].oracleId] : [],
  };
}

const complete = match('c1', ['Exquisite Blood', 'Sanguine Bond'], false);
const oneAway = match('c2', ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'], true);

function renderWith(inDeck: ComboMatch[], away: ComboMatch[]) {
  const data: ComboMatchResponse = {
    inDeck,
    oneAway: away,
    almostInCollection: [],
    source: 'local',
    almostInCollectionTotal: 0,
  };
  useDeckCombos.mockReturnValue({ data, loading: false, error: null, refetch: vi.fn() });
  return render(
    <DeckCombosPanel
      deckId="deck-1"
      deckOracleIds={['c1-0', 'c1-1', 'c2-0']}
      format="commander"
      onAdd={() => {}}
      embedded
    />
  );
}

const selected = (name: RegExp) =>
  screen.getByRole('tab', { name }).getAttribute('aria-selected') === 'true';

describe('DeckCombosPanel: default tab', () => {
  it('opens on One card away when nothing in the deck is complete', () => {
    renderWith([], [oneAway]);
    expect(selected(/^One card away/)).toBe(true);
    expect(screen.getByText(/Kiki-Jiki/)).toBeTruthy();
  });

  it('opens on In deck when a combo is complete', () => {
    renderWith([complete], [oneAway]);
    expect(selected(/^In deck/)).toBe(true);
  });

  it("keeps the owner's pick, and the empty In deck tab points at the next one", () => {
    renderWith([], [oneAway]);
    fireEvent.click(screen.getByRole('tab', { name: /^In deck/ }));
    expect(selected(/^In deck/)).toBe(true);
    expect(screen.getByText('No complete combos in this deck.')).toBeTruthy();
    expect(screen.getByText('1 combo is one card away. Check the next tab.')).toBeTruthy();
  });
});
