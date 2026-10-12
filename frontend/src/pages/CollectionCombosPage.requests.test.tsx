// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { __testing } from '@/lib/deck-analysis/use-deck-combos';

// E319: the page used to run the matcher once against the empty/partial
// collection that exists while the store hydrates and again once the full one
// landed. On the server fallback that was two POSTs to /api/combos/match.
// This drives the REAL useDeckCombos so the guard is on requests, not props.
const matchCombos = vi.fn(async (_req: unknown) => ({
  inDeck: [],
  oneAway: [],
  almostInCollection: [],
  almostInCollectionTotal: 0,
  source: 'local' as const,
}));
vi.mock('../lib/api/combos', () => ({
  matchCombos: (req: unknown) => matchCombos(req),
  searchCombos: async () => null,
}));
vi.mock('@/lib/api/combos', () => ({
  matchCombos: (req: unknown) => matchCombos(req),
  searchCombos: async () => null,
}));
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/sync', () => ({ getSyncState: () => 'ready', onSyncedChange: () => () => {} }));
vi.mock('@/components/card/CardPreview', () => ({ CardPreview: () => null }));

const store = { cards: [] as unknown[], hydrating: true };
vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) =>
    sel({ cards: store.cards, binders: [], lists: [], hydrating: store.hydrating }),
}));
vi.mock('../store/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ status: 'guest' }),
}));

import { CollectionCombosPage } from './CollectionCombosPage';

const card = (oracleId: string) => ({
  oracleId,
  name: oracleId,
  typeLine: 'Creature',
  colorIdentity: [],
  purchasePrice: 0,
});

function ui() {
  return (
    <MemoryRouter>
      <CollectionCombosPage />
    </MemoryRouter>
  );
}

describe('CollectionCombosPage request count (E319)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __testing.cache.clear();
    matchCombos.mockClear();
    store.cards = [];
    store.hydrating = true;
  });
  afterEach(() => vi.useRealTimers());

  it('matches once, against the hydrated collection, not once per growth step', async () => {
    const view = render(ui());
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(matchCombos).not.toHaveBeenCalled();

    // The store fills in two steps before it reports hydrated.
    store.cards = [card('a')];
    view.rerender(ui());
    store.cards = [card('a'), card('b')];
    store.hydrating = false;
    view.rerender(ui());
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));

    expect(matchCombos).toHaveBeenCalledTimes(1);
    expect(
      (matchCombos.mock.calls[0][0] as { ownedOracleIds: string[] }).ownedOracleIds.sort()
    ).toEqual(['a', 'b']);
  });
});
