// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { EnrichedCard, BinderDef } from '../types';
import type { PublicDeckCard } from './shared-types';

const loadCardMock = vi.fn();
vi.mock('./card-thumbs', () => ({
  loadCard: (name: string) => loadCardMock(name),
}));

let authStatus: 'guest' | 'authed' = 'authed';
vi.mock('../store/auth', () => ({
  useAuth: <T>(selector: (s: { status: string }) => T): T => selector({ status: authStatus }),
}));

let storeState: { hydrating: boolean; cards: EnrichedCard[]; binders: BinderDef[] } = {
  hydrating: false,
  cards: [],
  binders: [],
};
vi.mock('../store/collection', () => ({
  useCollectionStore: <T>(selector: (s: typeof storeState) => T): T => selector(storeState),
}));

import { useOwnershipLens } from './use-ownership-lens';

function deckCard(name: string, oracleId?: string): PublicDeckCard {
  return { card: oracleId ? { name, oracle_id: oracleId } : { name } };
}

function owned(over: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: over.copyId ?? `copy-${Math.random().toString(36).slice(2)}`,
    name: over.name ?? 'Sol Ring',
    setCode: over.setCode ?? 'lea',
    setName: over.setName ?? 'Limited Edition Alpha',
    collectorNumber: over.collectorNumber ?? '1',
    rarity: over.rarity ?? 'uncommon',
    scryfallId: over.scryfallId ?? 'sf-1',
    purchasePrice: over.purchasePrice ?? 0,
    sourceCategory: over.sourceCategory ?? '',
    sourceFormat: over.sourceFormat ?? 'manual',
    finish: over.finish ?? 'nonfoil',
    foil: over.foil ?? false,
    ...over,
  };
}

beforeEach(() => {
  authStatus = 'authed';
  storeState = { hydrating: false, cards: [], binders: [] };
  loadCardMock.mockReset();
});

describe('useOwnershipLens', () => {
  it('guest: resolves immediately with lens:null and never fires the price batch', () => {
    authStatus = 'guest';
    storeState = { hydrating: false, cards: [], binders: [] };
    const { result } = renderHook(() => useOwnershipLens([deckCard('Sol Ring', 'oracle-sol')]));
    expect(result.current).toEqual({
      lens: null,
      missingCost: null,
      missingCardPrices: new Map(),
      loading: false,
    });
    expect(loadCardMock).not.toHaveBeenCalled();
  });

  it('authed but still hydrating: loading:true, no lens yet, no price fetch', () => {
    storeState = { hydrating: true, cards: [], binders: [] };
    const { result } = renderHook(() => useOwnershipLens([deckCard('Sol Ring', 'oracle-sol')]));
    expect(result.current.lens).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(loadCardMock).not.toHaveBeenCalled();
  });

  it('authed, fully-owned deck: resolves missingCost:0 with no price fetch', () => {
    storeState = {
      hydrating: false,
      cards: [owned({ name: 'Sol Ring', oracleId: 'oracle-sol' })],
      binders: [],
    };
    const { result } = renderHook(() => useOwnershipLens([deckCard('Sol Ring', 'oracle-sol')]));
    expect(result.current.lens?.percentOwned).toBe(100);
    expect(result.current.missingCost).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(loadCardMock).not.toHaveBeenCalled();
  });

  it('the loading -> loaded transition for a partially-owned deck', async () => {
    loadCardMock.mockImplementation(
      (name: string) =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ name, prices: { usd: '5.00' } }), 0);
        })
    );
    storeState = { hydrating: false, cards: [], binders: [] };
    // Stable reference across re-renders (renderHook's callback re-runs on
    // every render — an inline array literal there would get a fresh
    // identity each time and defeat useOwnershipLens's own memoization).
    const deckCards = [deckCard('Sol Ring', 'oracle-sol'), deckCard('Lightning Bolt')];
    const { result } = renderHook(() => useOwnershipLens(deckCards));

    // Nothing owned yet -> both missing -> a price batch is in flight.
    expect(result.current.loading).toBe(true);
    expect(result.current.missingCost).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.missingCost).toBe(10);
    expect(result.current.missingCardPrices.get('Sol Ring')).toBe(5);
    expect(result.current.missingCardPrices.get('Lightning Bolt')).toBe(5);
  });

  it('a rejected price resolution still resolves missingCost instead of hanging in loading', async () => {
    loadCardMock.mockImplementation((name: string) =>
      name === 'Sol Ring'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ name, prices: { usd: '3.00' } })
    );
    storeState = { hydrating: false, cards: [], binders: [] };
    const deckCards = [deckCard('Sol Ring', 'oracle-sol'), deckCard('Lightning Bolt')];
    const { result } = renderHook(() => useOwnershipLens(deckCards));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // The rejected name contributes 0, not NaN, and loading still settles.
    expect(result.current.missingCost).toBe(3);
    expect(result.current.missingCardPrices.get('Sol Ring')).toBeNull();
    expect(result.current.missingCardPrices.get('Lightning Bolt')).toBe(3);
  });

  it('a missing/null Scryfall price contributes 0 (a basic land does not break the sum)', async () => {
    loadCardMock.mockResolvedValue({ name: 'Forest', prices: { usd: null } });
    storeState = { hydrating: false, cards: [], binders: [] };
    const deckCards = [deckCard('Forest', 'oracle-forest')];
    const { result } = renderHook(() => useOwnershipLens(deckCards));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.missingCost).toBe(0);
    expect(result.current.missingCardPrices.get('Forest')).toBeNull();
  });
});
