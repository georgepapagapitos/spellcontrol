// @vitest-environment happy-dom
/**
 * Defect 1: the Combos panel still LISTS a combo completed only via a
 * sideboard card (it's real — the combo is assembled) but marks it, since the
 * bracket/coach/hero never count it. See combo-zone-partition.ts.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComboMatchResponse } from '../../types/combos';

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

function comboData(): ComboMatchResponse {
  return {
    inDeck: [
      {
        combo: {
          id: 'c1',
          identity: 'wb',
          produces: ['Infinite drain'],
          prerequisites: null,
          description: null,
          manaNeeded: null,
          popularity: 10,
          cardCount: 2,
          bracket: 3,
          cards: [
            { oracleId: 'o1', cardName: 'Exquisite Blood', quantity: 1 },
            { oracleId: 'o2', cardName: 'Sanguine Bond', quantity: 1 },
          ],
        },
        presentOracleIds: ['o1', 'o2'],
        missingOracleIds: [],
      },
    ],
    oneAway: [],
    almostInCollection: [],
    source: 'local',
    almostInCollectionTotal: 0,
  };
}

function renderPanel(mainboardOracleIds?: Set<string>) {
  useDeckCombos.mockReturnValue({
    data: comboData(),
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  return render(
    <DeckCombosPanel
      deckId="deck-1"
      deckOracleIds={['o1', 'o2']}
      mainboardOracleIds={mainboardOracleIds}
      format="commander"
      onAdd={() => {}}
      embedded
    />
  );
}

describe('DeckCombosPanel — sideboard-completed combo mark', () => {
  it('marks an in-deck combo whose second piece is only in the sideboard', () => {
    renderPanel(new Set(['o1'])); // o2 (Sanguine Bond) is NOT on the mainboard
    expect(screen.getByText(/Uses sideboard: Sanguine Bond/)).toBeTruthy();
  });

  it('shows no mark when both pieces are on the mainboard', () => {
    renderPanel(new Set(['o1', 'o2']));
    expect(screen.queryByText(/Uses sideboard/)).toBeNull();
  });

  it('shows no mark when the caller omits mainboardOracleIds entirely', () => {
    renderPanel(undefined);
    expect(screen.queryByText(/Uses sideboard/)).toBeNull();
  });
});

// The panel's own counts and its one-away list read the 99, like the rest of
// the Power tab. A combo only "one card away" because a sideboard card fills
// one of its present slots isn't one add from firing in the deck, and its
// "add the missing piece" would complete nothing.
describe('DeckCombosPanel: counts and one-away read the mainboard', () => {
  function withOneAway(): ComboMatchResponse {
    const base = comboData();
    return {
      ...base,
      oneAway: [
        {
          combo: {
            ...base.inDeck[0].combo,
            id: 'c2',
            cards: [
              { oracleId: 'o3', cardName: 'Kiki-Jiki, Mirror Breaker', quantity: 1 },
              { oracleId: 'o4', cardName: 'Zealous Conscripts', quantity: 1 },
            ],
          },
          presentOracleIds: ['o3'],
          missingOracleIds: ['o4'],
        },
      ],
    };
  }

  function renderWith(data: ComboMatchResponse, mainboardOracleIds?: Set<string>) {
    useDeckCombos.mockReturnValue({ data, loading: false, error: null, refetch: vi.fn() });
    return render(
      <DeckCombosPanel
        deckId="deck-1"
        deckOracleIds={['o1', 'o2', 'o3']}
        mainboardOracleIds={mainboardOracleIds}
        format="commander"
        onAdd={() => {}}
        embedded
      />
    );
  }

  it('does not count a sideboard-completed combo as in the deck', () => {
    renderWith(comboData(), new Set(['o1'])); // o2 only in the sideboard
    expect(screen.getByRole('tab', { name: 'In deck, 0 combos' })).toBeTruthy();
  });

  it('drops a one-away combo whose present piece is only in the sideboard', () => {
    renderWith(withOneAway(), new Set(['o1', 'o2'])); // o3 (Kiki-Jiki) only in the sideboard
    expect(screen.getByRole('tab', { name: 'One card away, 0 combos' })).toBeTruthy();
  });

  it('keeps a one-away combo whose present pieces are all in the 99', () => {
    renderWith(withOneAway(), new Set(['o1', 'o2', 'o3']));
    expect(screen.getByRole('tab', { name: 'One card away, 1 combos' })).toBeTruthy();
  });
});
