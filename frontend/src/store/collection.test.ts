// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Wrap local-cards so persistence stays real by default but the hydrate
// error path can be forced per-test (ESM named exports aren't reassignable).
vi.mock('../lib/local-cards', async (importActual) => {
  const actual = await importActual<typeof import('../lib/local-cards')>();
  return {
    ...actual,
    saveCollection: vi.fn(actual.saveCollection),
    loadCollection: vi.fn(actual.loadCollection),
    clearCollection: vi.fn(actual.clearCollection),
  };
});

import { useCollectionStore } from './collection';
import { useDecksStore } from './decks';
import { useToastsStore } from './toasts';
import { saveCollection, loadCollection, clearCollection } from '../lib/local-cards';
import { _resetForTests as resetPriceCache } from '../lib/card-prices';
import { captureCollectionSnapshot } from '../lib/collection-snapshot';
import type { BinderDef, BinderInput, EnrichedCard, UploadResponse } from '../types';

function enriched(
  overrides: Partial<EnrichedCard> & { copyId: string; scryfallId: string }
): EnrichedCard {
  return {
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    oracleId: 'oracle-solring',
    ...overrides,
  } as EnrichedCard;
}

function uploadResponse(cards: EnrichedCard[]): UploadResponse {
  return {
    cards,
    totalRows: cards.length,
    scryfallHits: cards.length,
    scryfallMisses: 0,
    unresolvedNames: [],
    fetchErrors: [],
    malformedRows: [],
    skippedUnownedRows: 0,
    clampedRows: 0,
    detectedFormat: 'plain',
  };
}

function binderInput(over: Partial<BinderInput> = {}): BinderInput {
  return {
    name: 'B',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    ...over,
  } as BinderInput;
}

function makeBinder(over: Partial<BinderDef> = {}): BinderDef {
  return {
    id: 'b1',
    name: 'Pinned',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as BinderDef;
}

const RESET = {
  cards: [],
  binders: [],
  lists: [],
  fileName: '',
  scryfallHits: 0,
  scryfallMisses: 0,
  uploadedAt: null,
  unresolvedNames: [],
  detectedFormat: '',
  importHistory: [],
  hydrating: false,
  isLoading: false,
  isRefreshingPrices: false,
  error: null,
  activeTab: 'uncategorized',
  editingBinder: null,
  search: '',
};

beforeEach(async () => {
  vi.mocked(loadCollection).mockClear();
  vi.mocked(saveCollection).mockClear();
  vi.mocked(clearCollection).mockClear();
  await clearCollection();
  useDecksStore.setState({ decks: [], hydrated: true });
  useCollectionStore.setState({ ...RESET });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hydrateCards', () => {
  it('loads a stored collection and preserves an explicit import history', async () => {
    await saveCollection({
      fileName: 'mine.csv',
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 1234,
      importHistory: [{ id: 'i1', name: 'mine.csv', count: 1, format: 'plain', addedAt: 1234 }],
      lists: [],
    });
    useCollectionStore.setState({ ...RESET, hydrating: true });

    await useCollectionStore.getState().hydrateCards();

    const s = useCollectionStore.getState();
    expect(s.hydrating).toBe(false);
    expect(s.cards.map((c) => c.copyId)).toEqual(['c1']);
    expect(s.importHistory).toEqual([
      { id: 'i1', name: 'mine.csv', count: 1, format: 'plain', addedAt: 1234 },
    ]);
  });

  it('yields an empty history when nothing was ever imported', async () => {
    await saveCollection({
      fileName: '',
      cards: [],
      scryfallHits: 0,
      scryfallMisses: 0,
      uploadedAt: 0,
      importHistory: [],
      lists: [],
    });
    await useCollectionStore.getState().hydrateCards();
    expect(useCollectionStore.getState().importHistory).toEqual([]);
  });

  it('sets error and still clears hydrating when the load fails', async () => {
    vi.mocked(loadCollection).mockRejectedValueOnce(new Error('disk gone'));
    useCollectionStore.setState({ ...RESET, hydrating: true });

    await useCollectionStore.getState().hydrateCards();

    const s = useCollectionStore.getState();
    expect(s.error).toBe('disk gone');
    expect(s.hydrating).toBe(false);
  });

  it('remaps deck allocations when hydrated cards are present', async () => {
    await saveCollection({
      fileName: 'm',
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 1,
      importHistory: [{ id: 'i', name: 'm', count: 1, format: '', addedAt: 1 }],
      lists: [],
    });
    const remapAllocations = vi.fn();
    useDecksStore.setState({
      decks: [{ id: 'd1' } as never],
      hydrated: true,
      remapAllocations,
    } as never);

    await useCollectionStore.getState().hydrateCards();
    expect(remapAllocations).toHaveBeenCalledTimes(1);
  });
});

describe('deleteImports', () => {
  it('is a no-op for an empty id list', async () => {
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    await useCollectionStore.getState().deleteImports([]);
    expect(useCollectionStore.getState().cards).toHaveLength(1);
    expect(saveCollection).not.toHaveBeenCalled();
  });

  it('removes only the targeted import, keeping legacy un-stamped cards', async () => {
    useCollectionStore.setState({
      cards: [
        enriched({ copyId: 'a', scryfallId: 'sfA', importId: 'imp1' }),
        enriched({ copyId: 'b', scryfallId: 'sfB', importId: 'imp2' }),
        enriched({ copyId: 'legacy', scryfallId: 'sfL' }), // no importId — untouched
      ],
      importHistory: [
        { id: 'imp1', name: 'one', count: 1, format: '', addedAt: 1 },
        { id: 'imp2', name: 'two', count: 1, format: '', addedAt: 2 },
      ],
      fileName: 'two',
    });

    await useCollectionStore.getState().deleteImports(['imp1']);

    const s = useCollectionStore.getState();
    expect(s.cards.map((c) => c.copyId).sort()).toEqual(['b', 'legacy']);
    expect(s.importHistory.map((h) => h.id)).toEqual(['imp2']);
    expect(saveCollection).toHaveBeenCalled();
  });

  it('resets top-level metadata and clears the cache when the last import goes', async () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'a', scryfallId: 'sfA', importId: 'imp1' })],
      importHistory: [{ id: 'imp1', name: 'one', count: 1, format: 'plain', addedAt: 1 }],
      fileName: 'one',
      scryfallHits: 1,
      detectedFormat: 'plain',
      uploadedAt: 1,
    });

    await useCollectionStore.getState().deleteImports(['imp1']);

    const s = useCollectionStore.getState();
    expect(s.cards).toEqual([]);
    expect(s.importHistory).toEqual([]);
    expect(s.fileName).toBe('');
    expect(s.scryfallHits).toBe(0);
    expect(s.detectedFormat).toBe('');
    expect(s.uploadedAt).toBeNull();
    expect(clearCollection).toHaveBeenCalled();
  });
});

describe('updateCard / replaceAllCards / addCard', () => {
  it('updateCard patches the matching copy, preserving copyId and others', async () => {
    useCollectionStore.setState({
      cards: [
        enriched({ copyId: 'c1', scryfallId: 'sf1', purchasePrice: 1 }),
        enriched({ copyId: 'c2', scryfallId: 'sf2', purchasePrice: 1 }),
      ],
    });
    await useCollectionStore.getState().updateCard('c1', { purchasePrice: 9 });
    const cards = useCollectionStore.getState().cards;
    expect(cards.find((c) => c.copyId === 'c1')?.purchasePrice).toBe(9);
    expect(cards.find((c) => c.copyId === 'c2')?.purchasePrice).toBe(1);
    expect(saveCollection).toHaveBeenCalled();
  });

  it('replaceAllCards remaps when a copy is lost, and persists either way', async () => {
    const remapAllocations = vi.fn();
    useDecksStore.setState({
      decks: [{ id: 'd1' } as never],
      hydrated: true,
      remapAllocations,
    } as never);
    useCollectionStore.setState({
      cards: [
        enriched({ copyId: 'c1', scryfallId: 'sf1' }),
        enriched({ copyId: 'c2', scryfallId: 'sf2' }),
      ],
    });

    // Lost a copy → remap.
    await useCollectionStore
      .getState()
      .replaceAllCards([enriched({ copyId: 'c1', scryfallId: 'sf1' })]);
    expect(useCollectionStore.getState().cards.map((c) => c.copyId)).toEqual(['c1']);
    expect(remapAllocations).toHaveBeenCalledTimes(1);

    // Superset (no lost copy) → no further remap.
    await useCollectionStore
      .getState()
      .replaceAllCards([
        enriched({ copyId: 'c1', scryfallId: 'sf1' }),
        enriched({ copyId: 'c3', scryfallId: 'sf3' }),
      ]);
    expect(remapAllocations).toHaveBeenCalledTimes(1);
    expect(saveCollection).toHaveBeenCalled();
  });

  it('replaceAllCards sets an honest error when the local save fails', async () => {
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    vi.mocked(saveCollection).mockRejectedValueOnce(new Error('quota exceeded'));

    await useCollectionStore
      .getState()
      .replaceAllCards([enriched({ copyId: 'c1', scryfallId: 'sf1', purchasePrice: 5 })]);

    expect(useCollectionStore.getState().error).toMatch(/couldn't be saved locally/);
  });

  it('addCard appends a fresh copy from a Scryfall card and returns its copyId', async () => {
    const [copyId] = await useCollectionStore.getState().addCard(
      {
        id: 'sfX',
        name: 'Test',
        set: 'tst',
        set_name: 'Test Set',
        collector_number: '1',
        rarity: 'common',
        oracle_id: 'o1',
      } as never,
      'foil'
    );
    const card = useCollectionStore.getState().cards.find((c) => c.copyId === copyId);
    expect(card?.scryfallId).toBe('sfX');
    expect(saveCollection).toHaveBeenCalled();
  });

  it('addCard quantity creates N copies stamped with condition/language', async () => {
    const ids = await useCollectionStore.getState().addCard(
      {
        id: 'sfY',
        name: 'Playset',
        set: 'tst',
        set_name: 'Test Set',
        collector_number: '2',
        rarity: 'common',
        oracle_id: 'o2',
      } as never,
      'nonfoil',
      { quantity: 4, condition: 'lp', language: 'ja' }
    );
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    const rows = useCollectionStore.getState().cards.filter((c) => ids.includes(c.copyId));
    expect(rows).toHaveLength(4);
    expect(rows.every((c) => c.condition === 'lp' && c.language === 'ja')).toBe(true);
  });

  it('addCard sets an honest error when the local save fails', async () => {
    vi.mocked(saveCollection).mockRejectedValueOnce(new Error('quota exceeded'));

    await useCollectionStore.getState().addCard({
      id: 'sfZ',
      name: 'Test',
      set: 'tst',
      set_name: 'Test Set',
      collector_number: '3',
      rarity: 'common',
      oracle_id: 'o3',
    } as never);

    expect(useCollectionStore.getState().error).toMatch(/couldn't be saved locally/);
  });
});

describe('refreshPrices', () => {
  it('returns early with no cards (no request)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await useCollectionStore.getState().refreshPrices();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useCollectionStore.getState().isRefreshingPrices).toBe(false);
  });

  it('returns early when there are no usable scryfall ids', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: '' })] });
    await useCollectionStore.getState().refreshPrices();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stamps hits, marks requested misses fresh, leaves non-requested cards alone', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prices: { 'sf-hit': { usd: 12.5, pricedAt: 5000 } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({
      cards: [
        enriched({ copyId: 'h', scryfallId: 'sf-hit', purchasePrice: 1 }),
        enriched({ copyId: 'm', scryfallId: 'sf-miss', purchasePrice: 2 }),
        enriched({ copyId: 'o', scryfallId: 'sf-other', purchasePrice: 3 }),
      ],
    });

    await useCollectionStore.getState().refreshPrices(['sf-hit', 'sf-miss', '']);

    const byId = Object.fromEntries(useCollectionStore.getState().cards.map((c) => [c.copyId, c]));
    expect(byId.h.purchasePrice).toBe(12.5);
    expect(byId.h.pricedAt).toBe(5000);
    expect(byId.m.purchasePrice).toBe(2);
    expect(typeof byId.m.pricedAt).toBe('number'); // requested-but-missing → freshly stamped
    expect(byId.o.pricedAt).toBeUndefined(); // not requested → untouched
    expect(useCollectionStore.getState().isRefreshingPrices).toBe(false);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.scryfallIds.sort()).toEqual(['sf-hit', 'sf-miss']);
  });

  it('stamps a foil copy with the foil price, not the non-foil one', async () => {
    // Server returns a per-finish block for the printing; the foil copy must
    // pick usdFoil, the non-foil copy usd — same scryfallId, different prices.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prices: { sf1: { usd: 2, usdFoil: 9, usdEtched: 0, pricedAt: 7000 } },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({
      cards: [
        enriched({ copyId: 'nf', scryfallId: 'sf1', finish: 'nonfoil', purchasePrice: 0 }),
        enriched({ copyId: 'fo', scryfallId: 'sf1', finish: 'foil', purchasePrice: 0 }),
      ],
    });

    await useCollectionStore.getState().refreshPrices();

    const byId = Object.fromEntries(useCollectionStore.getState().cards.map((c) => [c.copyId, c]));
    expect(byId.nf.purchasePrice).toBe(2);
    expect(byId.fo.purchasePrice).toBe(9);
  });

  it('falls back to every unique collection id when called with no args', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prices: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({
      cards: [
        enriched({ copyId: 'a', scryfallId: 'sf1' }),
        enriched({ copyId: 'b', scryfallId: 'sf1' }),
        enriched({ copyId: 'c', scryfallId: 'sf2' }),
      ],
    });
    await useCollectionStore.getState().refreshPrices();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.scryfallIds.sort()).toEqual(['sf1', 'sf2']);
  });

  it('sets an error from a non-ok response and clears the spinner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'rate limited' }),
      })
    );
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    // Re-throws so callers (SettingsPage) can show a truthful error toast...
    await expect(
      useCollectionStore.getState().refreshPrices(undefined, { track: true })
    ).rejects.toThrow('rate limited');
    // ...while still recording the error and clearing the spinner + tracked progress.
    expect(useCollectionStore.getState().error).toBe('rate limited');
    expect(useCollectionStore.getState().isRefreshingPrices).toBe(false);
    expect(useCollectionStore.getState().priceRefreshProgress).toBeNull();
  });

  it('re-throws and sets an error when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    await expect(useCollectionStore.getState().refreshPrices()).rejects.toThrow('offline');
    expect(useCollectionStore.getState().error).toBe('offline');
    expect(useCollectionStore.getState().isRefreshingPrices).toBe(false);
    expect(useCollectionStore.getState().priceRefreshProgress).toBeNull();
  });

  it('retries a transient 502 and succeeds — the native boot-refresh symptom', async () => {
    resetPriceCache();
    localStorage.removeItem('spellcontrol:card-prices');
    // A cold/restarting Fly machine answers the first attempt with a 502, then
    // recovers. This is the exact shape that made a native boot-time refresh
    // fail where the warm web app didn't. It must NOT surface — a retry wins.
    let call = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 502,
          json: async () => ({ error: 'Bad Gateway' }),
        });
      }
      const { scryfallIds } = JSON.parse(init.body) as { scryfallIds: string[] };
      const prices = Object.fromEntries(
        scryfallIds.map((id) => [id, { usd: 5, usdFoil: 0, usdEtched: 0, pricedAt: 1000 }])
      );
      return Promise.resolve({ ok: true, json: async () => ({ prices }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });

    await expect(useCollectionStore.getState().refreshPrices()).resolves.toBeUndefined();

    expect(call).toBe(2); // one 502, one retry that succeeded
    expect(useCollectionStore.getState().error).toBeNull();
    expect(useCollectionStore.getState().cards[0].purchasePrice).toBe(5);
  });

  it('surfaces a 502 that never recovers after exhausting retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'Bad Gateway' }),
      })
    );
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    await expect(useCollectionStore.getState().refreshPrices()).rejects.toThrow('Bad Gateway');
    expect(useCollectionStore.getState().isRefreshingPrices).toBe(false);
  });

  it('pages a >1000-printing collection into chunks and prices ALL of it', async () => {
    // The server caps each request at 1000 ids; without client paging a large
    // collection only prices its first 1000 (and which 1000 is array-order
    // dependent → cross-device $0 divergence). Echo a price for every id asked.
    resetPriceCache();
    localStorage.removeItem('spellcontrol:card-prices');
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      const { scryfallIds } = JSON.parse(init.body) as { scryfallIds: string[] };
      const prices = Object.fromEntries(scryfallIds.map((id) => [id, { usd: 5, pricedAt: 1000 }]));
      return Promise.resolve({ ok: true, json: async () => ({ prices }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({
      cards: Array.from({ length: 1001 }, (_, i) =>
        enriched({ copyId: `c${i}`, scryfallId: `sf${i}`, purchasePrice: 0 })
      ),
    });

    await useCollectionStore.getState().refreshPrices();

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1000 + 1
    const cards = useCollectionStore.getState().cards;
    expect(cards).toHaveLength(1001);
    expect(cards.every((c) => c.purchasePrice === 5)).toBe(true); // none left at $0
  });

  it('surfaces chunk progress while a tracked (manual) refresh runs, then clears it', async () => {
    resetPriceCache();
    localStorage.removeItem('spellcontrol:card-prices');
    const seen: Array<{ done: number; total: number } | null> = [];
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      // Snapshot the live progress as each chunk's request is issued.
      seen.push(useCollectionStore.getState().priceRefreshProgress);
      const { scryfallIds } = JSON.parse(init.body) as { scryfallIds: string[] };
      const prices = Object.fromEntries(scryfallIds.map((id) => [id, { usd: 5, pricedAt: 1000 }]));
      return Promise.resolve({ ok: true, json: async () => ({ prices }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({
      cards: Array.from({ length: 1001 }, (_, i) =>
        enriched({ copyId: `c${i}`, scryfallId: `sf${i}`, purchasePrice: 0 })
      ),
    });

    await useCollectionStore.getState().refreshPrices(undefined, { track: true });

    // 2 chunks: chunk 1's request sees 0/2, chunk 2's sees 1/2 (prior chunk done).
    expect(seen).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
    ]);
    expect(useCollectionStore.getState().priceRefreshProgress).toBeNull(); // cleared after
  });

  it('keeps prices from earlier chunks when a later chunk drops (no all-or-nothing $0)', async () => {
    // The flaky-network bug: a multi-chunk refresh used to persist only after
    // ALL chunks landed, so one dropped chunk discarded everything → the whole
    // collection stuck at $0. Now each chunk persists as it lands.
    resetPriceCache();
    localStorage.removeItem('spellcontrol:card-prices');
    let call = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      call++;
      // Chunk 1 succeeds; chunk 2 drops the connection on every (retried) attempt.
      if (call >= 2) return Promise.reject(new Error('network'));
      const { scryfallIds } = JSON.parse(init.body) as { scryfallIds: string[] };
      const prices = Object.fromEntries(scryfallIds.map((id) => [id, { usd: 5, pricedAt: 1000 }]));
      return Promise.resolve({ ok: true, json: async () => ({ prices }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({
      cards: Array.from({ length: 1001 }, (_, i) =>
        enriched({ copyId: `c${i}`, scryfallId: `sf${i}`, purchasePrice: 0 })
      ),
    });

    await expect(useCollectionStore.getState().refreshPrices()).rejects.toThrow();

    // Chunk 1's 1000 cards are priced despite chunk 2 failing — not stuck at $0.
    const cards = useCollectionStore.getState().cards;
    expect(cards.filter((c) => c.purchasePrice === 5)).toHaveLength(1000);
  });

  it('leaves progress null for an untracked (background) refresh', async () => {
    resetPriceCache();
    localStorage.removeItem('spellcontrol:card-prices');
    let sawProgress = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        if (useCollectionStore.getState().priceRefreshProgress !== null) sawProgress = true;
        return Promise.resolve({ ok: true, json: async () => ({ prices: {} }) });
      })
    );
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });

    await useCollectionStore.getState().refreshPrices(); // no track → silent

    expect(sawProgress).toBe(false);
    expect(useCollectionStore.getState().priceRefreshProgress).toBeNull();
  });

  it('does not freeze a server-miss $0 card as fresh (keeps it stale to retry)', async () => {
    // A card the server has no price for must stay stale, not be stamped fresh —
    // otherwise a refresh run while the server cache was cold freezes it at $0
    // forever (the cross-device blank-prices bug).
    resetPriceCache();
    localStorage.removeItem('spellcontrol:card-prices');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ prices: {} }) })
    );
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'x', scryfallId: 'sfx', purchasePrice: 0 })],
    });

    await useCollectionStore.getState().refreshPrices();

    const card = useCollectionStore.getState().cards[0];
    expect(card.purchasePrice).toBe(0);
    expect(card.pricedAt).toBeUndefined(); // NOT stamped → still counts as stale
  });

  it('carries a POSITIVE last-known price over a transient server miss', async () => {
    resetPriceCache();
    localStorage.removeItem('spellcontrol:card-prices');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ prices: {} }) })
    );
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'p', scryfallId: 'sfp', purchasePrice: 7 })],
    });

    await useCollectionStore.getState().refreshPrices();

    const card = useCollectionStore.getState().cards[0];
    expect(card.purchasePrice).toBe(7); // kept, not flashed to $0
    expect(typeof card.pricedAt).toBe('number'); // refreshed timestamp
  });
});

describe('refreshPrices — binder auto-move notifications (T21)', () => {
  beforeEach(() => {
    resetPriceCache();
    localStorage.removeItem('spellcontrol:card-prices');
    useToastsStore.getState().clear();
  });

  const highValueBinder = (over: Partial<BinderDef> = {}): BinderDef =>
    makeBinder({
      id: 'bhv',
      name: 'High Value',
      filterGroups: [{ filter: { priceMin: 50 } }],
      ...over,
    });

  const priceResponse = (prices: Record<string, number>) =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prices: Object.fromEntries(
          Object.entries(prices).map(([id, usd]) => [id, { usd, pricedAt: 1000 }])
        ),
      }),
    });

  it('toasts a move INTO a binder when a price crosses the threshold', async () => {
    vi.stubGlobal('fetch', priceResponse({ 't21-a': 60 }));
    useCollectionStore.setState({
      binders: [highValueBinder()],
      cards: [enriched({ copyId: 'a', scryfallId: 't21-a', name: 'Sol Ring', purchasePrice: 40 })],
    });

    await useCollectionStore.getState().refreshPrices();

    const toasts = useToastsStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Sol Ring moved to High Value (price ↑)');
    expect(toasts[0].tone).toBe('info');
    expect(toasts[0].actionLabel).toBe('View binder');
  });

  it('toasts a move OUT to Uncategorized when a price drops below the threshold', async () => {
    vi.stubGlobal('fetch', priceResponse({ 't21-a': 40 }));
    useCollectionStore.setState({
      binders: [highValueBinder()],
      cards: [enriched({ copyId: 'a', scryfallId: 't21-a', name: 'Sol Ring', purchasePrice: 60 })],
    });

    await useCollectionStore.getState().refreshPrices();

    const toasts = useToastsStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Sol Ring left High Value (price ↓)');
    // No destination binder to open → plain (actionless) toast.
    expect(toasts[0].actionLabel).toBeUndefined();
  });

  it('does not toast when membership is unchanged', async () => {
    vi.stubGlobal('fetch', priceResponse({ 't21-a': 70 }));
    useCollectionStore.setState({
      binders: [highValueBinder()],
      cards: [enriched({ copyId: 'a', scryfallId: 't21-a', purchasePrice: 60 })], // stays >= 50
    });

    await useCollectionStore.getState().refreshPrices();
    expect(useToastsStore.getState().toasts).toHaveLength(0);
  });

  it('collapses into a single digest toast when more cards move than the cap', async () => {
    const ids = ['t21-1', 't21-2', 't21-3', 't21-4', 't21-5'];
    vi.stubGlobal('fetch', priceResponse(Object.fromEntries(ids.map((id) => [id, 60]))));
    useCollectionStore.setState({
      binders: [highValueBinder()],
      cards: ids.map((id, i) =>
        enriched({ copyId: `c${i}`, scryfallId: id, name: `Card ${i}`, purchasePrice: 40 })
      ),
    });

    await useCollectionStore.getState().refreshPrices();

    const toasts = useToastsStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('5 cards moved between binders (prices updated).');
    expect(toasts[0].actionLabel).toBe('View');
  });

  it('does not count deck-allocated copies as moves for hideDeckAllocated binders', async () => {
    vi.stubGlobal('fetch', priceResponse({ 't21-a': 60 }));
    useDecksStore.setState({
      decks: [
        {
          id: 'd1',
          name: 'Deck',
          color: '#000',
          cards: [{ slotId: 's1', card: { id: 'x', name: 'Sol Ring' }, allocatedCopyId: 'a' }],
          sideboard: [],
        } as unknown as ReturnType<typeof useDecksStore.getState>['decks'][number],
      ],
      hydrated: true,
    });
    useCollectionStore.setState({
      binders: [highValueBinder({ hideDeckAllocated: false })],
      cards: [enriched({ copyId: 'a', scryfallId: 't21-a', name: 'Sol Ring', purchasePrice: 40 })],
    });

    await useCollectionStore.getState().refreshPrices();
    expect(useToastsStore.getState().toasts).toHaveLength(0);
  });
});

describe('autoRefreshStalePrices', () => {
  const THROTTLE_KEY = 'spellcontrol:lastPriceAutoRefreshAttempt';
  beforeEach(() => localStorage.removeItem(THROTTLE_KEY));

  it('no-ops with an empty collection', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await useCollectionStore.getState().autoRefreshStalePrices();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips when every price is fresh (priced within the last day)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1', pricedAt: Date.now() })],
    });
    await useCollectionStore.getState().autoRefreshStalePrices();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes when a price is stale and records the attempt timestamp', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ prices: {} }) });
    vi.stubGlobal('fetch', fetchMock);
    // no pricedAt → maximally stale
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    await useCollectionStore.getState().autoRefreshStalePrices();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Number(localStorage.getItem(THROTTLE_KEY))).toBeGreaterThan(0);
  });

  it('skips when an attempt fired within the retry window', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(THROTTLE_KEY, String(Date.now()));
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    await useCollectionStore.getState().autoRefreshStalePrices();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows the refresh error so a background run never rejects', async () => {
    // refreshPrices re-throws on failure (so SettingsPage can toast); the
    // background auto-refresh must absorb it — no unhandled rejection on boot.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    await expect(useCollectionStore.getState().autoRefreshStalePrices()).resolves.toBeUndefined();
    expect(useCollectionStore.getState().error).toBe('offline');
  });

  it('skips when the browser reports offline', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const desc = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    try {
      await useCollectionStore.getState().autoRefreshStalePrices();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (desc) Object.defineProperty(navigator, 'onLine', desc);
      else Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
  });

  it('shows the progress pill when the whole collection is unpriced (fresh device)', async () => {
    // Capture priceRefreshProgress at fetch time — the pill is live during the
    // run, then cleared. A freshly-synced device is unpriced everywhere.
    let progressDuringFetch: unknown = null;
    const fetchMock = vi.fn().mockImplementation(async () => {
      progressDuringFetch = useCollectionStore.getState().priceRefreshProgress;
      return { ok: true, json: async () => ({ prices: {} }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    useCollectionStore.setState({
      cards: [
        enriched({ copyId: 'c1', scryfallId: 'sf1', purchasePrice: 0 }),
        enriched({ copyId: 'c2', scryfallId: 'sf2', purchasePrice: 0 }),
      ],
    });
    await useCollectionStore.getState().autoRefreshStalePrices();
    expect(fetchMock).toHaveBeenCalled();
    expect(progressDuringFetch).not.toBeNull();
    expect(useCollectionStore.getState().priceRefreshProgress).toBeNull(); // cleared after
  });

  it('stays silent (no pill) when some cards are already priced (routine staleness)', async () => {
    let progressDuringFetch: unknown = 'unset';
    const fetchMock = vi.fn().mockImplementation(async () => {
      progressDuringFetch = useCollectionStore.getState().priceRefreshProgress;
      return { ok: true, json: async () => ({ prices: {} }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    // Stale (priced back at epoch) but a real price exists → a normal daily
    // refresh, not a fresh fill, so the pill must not flash.
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1', purchasePrice: 2, pricedAt: 1 })],
    });
    await useCollectionStore.getState().autoRefreshStalePrices();
    expect(fetchMock).toHaveBeenCalled();
    expect(progressDuringFetch).toBeNull();
  });
});

describe('backup snapshot / restore', () => {
  it('builds a snapshot with a populated collection', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      fileName: 'mine.csv',
      binders: [makeBinder()],
      importHistory: [{ id: 'i', name: 'mine.csv', count: 1, format: '', addedAt: 1 }],
    });
    const backup = useCollectionStore.getState().buildBackupSnapshot();
    expect(backup.collection?.cards).toHaveLength(1);
    expect(backup.collection?.fileName).toBe('mine.csv');
    expect(backup.binders).toHaveLength(1);
  });

  it('builds a snapshot with a null collection when there are no cards', () => {
    useCollectionStore.setState({ cards: [], binders: [makeBinder()] });
    const backup = useCollectionStore.getState().buildBackupSnapshot();
    expect(backup.collection).toBeNull();
    expect(backup.binders).toHaveLength(1);
  });

  it('restores cards + binders from a backup and persists', async () => {
    const backup = {
      format: 'spellcontrol-backup' as const,
      version: 1,
      exportedAt: 1,
      collection: {
        fileName: 'restored.csv',
        cards: [enriched({ copyId: 'r1', scryfallId: 'sf1' })],
        scryfallHits: 1,
        scryfallMisses: 0,
        uploadedAt: 42,
        importHistory: [{ id: 'i', name: 'restored.csv', count: 1, format: '', addedAt: 42 }],
        lists: [],
      },
      binders: [makeBinder({ id: 'rb' })],
    };
    await useCollectionStore.getState().restoreFromBackup(backup);
    const s = useCollectionStore.getState();
    expect(s.cards.map((c) => c.copyId)).toEqual(['r1']);
    expect(s.fileName).toBe('restored.csv');
    expect(s.activeTab).toBe('rb');
    expect(saveCollection).toHaveBeenCalled();
    expect((await loadCollection())?.cards).toHaveLength(1);
  });

  it('restoring a collection-less backup empties cards and clears the cache', async () => {
    useCollectionStore.setState({ cards: [enriched({ copyId: 'x', scryfallId: 'sf1' })] });
    const backup = {
      format: 'spellcontrol-backup' as const,
      version: 1,
      exportedAt: 1,
      collection: null,
      binders: [],
    };
    await useCollectionStore.getState().restoreFromBackup(backup);
    const s = useCollectionStore.getState();
    expect(s.cards).toEqual([]);
    expect(s.activeTab).toBe('uncategorized');
    expect(clearCollection).toHaveBeenCalled();
  });
});

describe('binder card customization', () => {
  it('pinCardToBinder pins once, captures the durable key, and is idempotent', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1', finish: 'nonfoil' })],
      binders: [makeBinder()],
    });
    expect(useCollectionStore.getState().pinCardToBinder('b1', 'c1')).toBe(true);
    let b = useCollectionStore.getState().binders[0];
    expect(b.pinnedCopyIds).toEqual(['c1']);
    expect(b.pinnedKeys).toEqual(['sf1:nonfoil']);

    // Second pin of the same copy is a no-op.
    expect(useCollectionStore.getState().pinCardToBinder('b1', 'c1')).toBe(false);
    b = useCollectionStore.getState().binders[0];
    expect(b.pinnedCopyIds).toEqual(['c1']);
  });

  it('pinCardToBinder flips a rules binder to manual when the card breaks its rules', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1', rarity: 'uncommon' })],
      binders: [
        makeBinder({
          mode: 'rules',
          filterGroups: [
            { filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } } },
          ],
        }),
      ],
    });
    useCollectionStore.getState().pinCardToBinder('b1', 'c1');
    expect(useCollectionStore.getState().binders[0].mode).toBe('manual');
  });

  it('removeCardFromBinder excludes a rule-matched card, idempotently', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      binders: [makeBinder()],
    });
    useCollectionStore.getState().removeCardFromBinder('b1', 'c1', true);
    let b = useCollectionStore.getState().binders[0];
    expect(b.excludedCopyIds).toEqual(['c1']);
    const keysAfterFirst = b.excludedKeys;
    useCollectionStore.getState().removeCardFromBinder('b1', 'c1', true);
    b = useCollectionStore.getState().binders[0];
    expect(b.excludedCopyIds).toEqual(['c1']);
    expect(b.excludedKeys).toEqual(keysAfterFirst);
  });

  it('removeCardFromBinder drops a non-rule card from pins and manual order', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      binders: [makeBinder({ pinnedCopyIds: ['c1'], pinnedKeys: ['sf1:nonfoil'] })],
    });
    useCollectionStore.getState().setBinderManualOrder('b1', ['c1']);
    useCollectionStore.getState().removeCardFromBinder('b1', 'c1', false);
    const b = useCollectionStore.getState().binders[0];
    expect(b.pinnedCopyIds).toEqual([]);
    expect(b.manualOrder).toEqual([]);
  });

  it('restoreExcludedCard removes a card from the exclusion list', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      binders: [makeBinder({ excludedCopyIds: ['c1'], excludedKeys: ['sf1:nonfoil'] })],
    });
    useCollectionStore.getState().restoreExcludedCard('b1', 'c1');
    expect(useCollectionStore.getState().binders[0].excludedCopyIds).toEqual([]);
  });

  it('setBinderMode and setBinderManualOrder (set + clear)', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      binders: [makeBinder()],
    });
    useCollectionStore.getState().setBinderMode('b1', 'manual');
    expect(useCollectionStore.getState().binders[0].mode).toBe('manual');

    useCollectionStore.getState().setBinderManualOrder('b1', ['c1']);
    expect(useCollectionStore.getState().binders[0].manualOrder).toEqual(['c1']);
    expect(useCollectionStore.getState().binders[0].manualKeys).toEqual(['sf1:nonfoil']);

    useCollectionStore.getState().setBinderManualOrder('b1', undefined);
    expect(useCollectionStore.getState().binders[0].manualOrder).toBeUndefined();
    expect(useCollectionStore.getState().binders[0].manualKeys).toBeUndefined();
  });

  it('seedManualOrder snapshots the current order with durable keys', () => {
    useCollectionStore.setState({
      cards: [
        enriched({ copyId: 'c1', scryfallId: 'sf1' }),
        enriched({ copyId: 'c2', scryfallId: 'sf2' }),
      ],
      binders: [makeBinder()],
    });
    useCollectionStore.getState().seedManualOrder('b1', ['c2', 'c1']);
    const b = useCollectionStore.getState().binders[0];
    expect(b.manualOrder).toEqual(['c2', 'c1']);
    expect(b.manualKeys).toEqual(['sf2:nonfoil', 'sf1:nonfoil']);
  });

  it('binder customization actions no-op on an unknown binder id', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      binders: [makeBinder()],
    });
    const before = useCollectionStore.getState().binders[0];
    useCollectionStore.getState().removeCardFromBinder('nope', 'c1', true);
    useCollectionStore.getState().restoreExcludedCard('nope', 'c1');
    useCollectionStore.getState().setBinderMode('nope', 'manual');
    useCollectionStore.getState().setBinderManualOrder('nope', ['c1']);
    useCollectionStore.getState().seedManualOrder('nope', ['c1']);
    expect(useCollectionStore.getState().binders[0]).toEqual(before);
  });

  it('keepCardInBinder pins a card WITHOUT flipping a rules binder to manual (E88)', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1', rarity: 'uncommon' })],
      binders: [
        makeBinder({
          mode: 'rules',
          filterGroups: [
            { filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } } },
          ],
        }),
      ],
    });
    useCollectionStore.getState().keepCardInBinder('b1', 'c1');
    const b = useCollectionStore.getState().binders[0];
    expect(b.pinnedCopyIds).toEqual(['c1']);
    expect(b.mode).toBe('rules'); // no auto-flip, unlike pinCardToBinder
  });

  it('keepCardInBinder is idempotent and no-ops on an unknown binder', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      binders: [makeBinder()],
    });
    useCollectionStore.getState().keepCardInBinder('b1', 'c1');
    useCollectionStore.getState().keepCardInBinder('b1', 'c1');
    expect(useCollectionStore.getState().binders[0].pinnedCopyIds).toEqual(['c1']);

    const before = useCollectionStore.getState().binders[0];
    useCollectionStore.getState().keepCardInBinder('nope', 'c1');
    expect(useCollectionStore.getState().binders[0]).toEqual(before);
  });

  it('acknowledgeBinderCard applies a surgical add/remove to the review baseline', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      binders: [
        makeBinder({
          lastReviewedSnapshot: { at: 1, keys: ['sf1:nonfoil'], cardSnapshots: {} },
        }),
      ],
    });
    useCollectionStore.getState().acknowledgeBinderCard('b1', 'sf1:nonfoil', 'removed');
    expect(useCollectionStore.getState().binders[0].lastReviewedSnapshot?.keys).toEqual([]);

    const card = enriched({ copyId: 'c2', scryfallId: 'sf2', purchasePrice: 4.5 });
    useCollectionStore.getState().acknowledgeBinderCard('b1', 'sf2:nonfoil', 'added', card);
    const b = useCollectionStore.getState().binders[0];
    expect(b.lastReviewedSnapshot?.keys).toEqual(['sf2:nonfoil']);
    expect(b.lastReviewedSnapshot?.cardSnapshots['sf2:nonfoil']).toEqual({ price: 4.5 });
  });

  it('acknowledgeBinderCard no-ops on a binder with no baseline yet', () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      binders: [makeBinder()],
    });
    const before = useCollectionStore.getState().binders[0];
    useCollectionStore.getState().acknowledgeBinderCard('b1', 'sf1:nonfoil', 'removed');
    expect(useCollectionStore.getState().binders[0]).toEqual(before);
  });
});

describe('binder CRUD', () => {
  it('createBinder appends and activates the new binder', () => {
    const created = useCollectionStore.getState().createBinder(binderInput({ name: 'Lands' }));
    expect(created.name).toBe('Lands');
    expect(created.position).toBe(0);
    expect(useCollectionStore.getState().binders).toHaveLength(1);
    expect(useCollectionStore.getState().activeTab).toBe(created.id);
  });

  it('updateBinder merges fields but keeps the id', () => {
    useCollectionStore.setState({ binders: [makeBinder({ id: 'b1', name: 'Old' })] });
    useCollectionStore.getState().updateBinder('b1', { name: 'New' } as Partial<BinderInput>);
    const b = useCollectionStore.getState().binders[0];
    expect(b.id).toBe('b1');
    expect(b.name).toBe('New');
  });

  it("updateBinder clears the review baseline when a rules-mode binder's filterGroups change (E88)", () => {
    useCollectionStore.setState({
      binders: [
        makeBinder({
          id: 'b1',
          mode: 'rules',
          filterGroups: [{ filter: { rarities: { chips: [], joiners: [] } } }],
          lastReviewedSnapshot: { at: 1, keys: ['sf1:nonfoil'], cardSnapshots: {} },
        }),
      ],
    });
    useCollectionStore.getState().updateBinder('b1', {
      filterGroups: [
        { filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } } },
      ],
    });
    expect(useCollectionStore.getState().binders[0].lastReviewedSnapshot).toBeUndefined();
  });

  it('updateBinder keeps the review baseline when filterGroups are unchanged or absent from the input', () => {
    const groups = [
      { filter: { rarities: { chips: [], joiners: [] } } },
    ] as BinderInput['filterGroups'];
    useCollectionStore.setState({
      binders: [
        makeBinder({
          id: 'b1',
          mode: 'rules',
          filterGroups: groups,
          lastReviewedSnapshot: { at: 1, keys: ['sf1:nonfoil'], cardSnapshots: {} },
        }),
      ],
    });
    // Same content, new array reference — a deep-equal edit shouldn't re-baseline.
    useCollectionStore
      .getState()
      .updateBinder('b1', { filterGroups: JSON.parse(JSON.stringify(groups)) });
    expect(useCollectionStore.getState().binders[0].lastReviewedSnapshot).toBeDefined();

    // No filterGroups in the input at all (e.g. a sort-only edit) — untouched.
    useCollectionStore.getState().updateBinder('b1', { name: 'Renamed' } as Partial<BinderInput>);
    expect(useCollectionStore.getState().binders[0].lastReviewedSnapshot).toBeDefined();
  });

  it('updateBinder does not re-baseline a manual-mode binder on filterGroups changes', () => {
    useCollectionStore.setState({
      binders: [
        makeBinder({
          id: 'b1',
          mode: 'manual',
          filterGroups: [{ filter: {} }],
          lastReviewedSnapshot: { at: 1, keys: ['sf1:nonfoil'], cardSnapshots: {} },
        }),
      ],
    });
    useCollectionStore.getState().updateBinder('b1', {
      filterGroups: [
        { filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } } },
      ],
    });
    expect(useCollectionStore.getState().binders[0].lastReviewedSnapshot).toBeDefined();
  });

  it('deleteBinder renumbers positions and re-points the active tab', () => {
    useCollectionStore.setState({
      binders: [
        makeBinder({ id: 'b1', position: 0 }),
        makeBinder({ id: 'b2', position: 1 }),
        makeBinder({ id: 'b3', position: 2 }),
      ],
      activeTab: 'b2',
    });
    useCollectionStore.getState().deleteBinder('b2');
    const s = useCollectionStore.getState();
    expect(s.binders.map((b) => b.id)).toEqual(['b1', 'b3']);
    expect(s.binders.map((b) => b.position)).toEqual([0, 1]);
    expect(s.activeTab).toBe('b1');
  });

  it('deleteBinder of the last binder falls back to uncategorized', () => {
    useCollectionStore.setState({ binders: [makeBinder({ id: 'b1' })], activeTab: 'b1' });
    useCollectionStore.getState().deleteBinder('b1');
    expect(useCollectionStore.getState().activeTab).toBe('uncategorized');
  });

  it('deleteAllBinders clears everything', () => {
    useCollectionStore.setState({
      binders: [makeBinder({ id: 'b1' }), makeBinder({ id: 'b2' })],
      activeTab: 'b2',
    });
    useCollectionStore.getState().deleteAllBinders();
    expect(useCollectionStore.getState().binders).toEqual([]);
    expect(useCollectionStore.getState().activeTab).toBe('uncategorized');
  });

  it('deleteAllLists clears every list', () => {
    useCollectionStore.getState().createList('Wishlist');
    useCollectionStore.getState().createList('Trade pile');
    expect(useCollectionStore.getState().lists).toHaveLength(2);
    useCollectionStore.getState().deleteAllLists();
    expect(useCollectionStore.getState().lists).toEqual([]);
  });

  it('deleteBinders (bulk) removes the set, renumbers, and re-points active tab', () => {
    useCollectionStore.setState({
      binders: [
        makeBinder({ id: 'b1', position: 0 }),
        makeBinder({ id: 'b2', position: 1 }),
        makeBinder({ id: 'b3', position: 2 }),
      ],
      activeTab: 'b2',
    });
    useCollectionStore.getState().deleteBinders(['b1', 'b2']);
    const s = useCollectionStore.getState();
    expect(s.binders.map((b) => b.id)).toEqual(['b3']);
    expect(s.binders.map((b) => b.position)).toEqual([0]);
    expect(s.activeTab).toBe('b3');
  });

  it('deleteLists (bulk) removes the set and reorders the rest', () => {
    const a = useCollectionStore.getState().createList('A');
    useCollectionStore.getState().createList('B');
    const c = useCollectionStore.getState().createList('C');
    useCollectionStore.getState().deleteLists([a, c]);
    const lists = useCollectionStore.getState().lists;
    expect(lists.map((l) => l.name)).toEqual(['B']);
    expect(lists.map((l) => l.order)).toEqual([0]);
  });

  it('moveBinder swaps neighbors and no-ops at the boundary / unknown id', () => {
    useCollectionStore.setState({
      binders: [makeBinder({ id: 'b1', position: 0 }), makeBinder({ id: 'b2', position: 1 })],
    });
    useCollectionStore.getState().moveBinder('b2', 'up');
    expect(useCollectionStore.getState().binders.map((b) => b.id)).toEqual(['b2', 'b1']);

    // b2 is now first — moving it up again is a boundary no-op.
    useCollectionStore.getState().moveBinder('b2', 'up');
    expect(useCollectionStore.getState().binders.map((b) => b.id)).toEqual(['b2', 'b1']);

    // Unknown id is a no-op.
    useCollectionStore.getState().moveBinder('ghost', 'down');
    expect(useCollectionStore.getState().binders.map((b) => b.id)).toEqual(['b2', 'b1']);
  });
});

describe('loadSampleBinders', () => {
  it('creates only the sample binders when no import response is given', async () => {
    const ids = await useCollectionStore.getState().loadSampleBinders(null);
    const s = useCollectionStore.getState();
    expect(ids.length).toBeGreaterThan(0);
    expect(s.binders).toHaveLength(ids.length);
    expect(s.cards).toEqual([]);
    expect(s.activeTab).toBe(ids[0]);
  });

  it('imports the bundled pack in replace mode when the collection is empty', async () => {
    await useCollectionStore
      .getState()
      .loadSampleBinders(uploadResponse([enriched({ copyId: 's1', scryfallId: 'sf1' })]));
    const s = useCollectionStore.getState();
    expect(s.cards.map((c) => c.copyId)).toEqual(['s1']);
    expect(s.importHistory.some((h) => h.isSample)).toBe(true);
  });

  it('imports the bundled pack in merge mode when cards already exist', async () => {
    useCollectionStore.setState({
      cards: [enriched({ copyId: 'existing', scryfallId: 'sfE', importId: 'old' })],
      importHistory: [{ id: 'old', name: 'x', count: 1, format: '', addedAt: 1 }],
    });
    await useCollectionStore
      .getState()
      .loadSampleBinders(uploadResponse([enriched({ copyId: 's1', scryfallId: 'sf1' })]));
    const ids = useCollectionStore.getState().cards.map((c) => c.copyId);
    expect(ids).toContain('existing');
    expect(ids).toContain('s1');
  });
});

describe('UI / config setters', () => {
  it('sets simple UI flags and values', () => {
    const g = useCollectionStore.getState();
    g.setActiveTab('tab-x');
    g.setEditingBinder('b9');
    g.setSearch('bolt');
    g.setLoading(true);
    g.setError('boom');
    const s = useCollectionStore.getState();
    expect(s.activeTab).toBe('tab-x');
    expect(s.editingBinder).toBe('b9');
    expect(s.search).toBe('bolt');
    expect(s.isLoading).toBe(true);
    expect(s.error).toBe('boom');
  });
});

describe('destructive-op undo', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const undoToast = () => useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');

  beforeEach(() => {
    useToastsStore.setState({ toasts: [] });
  });

  describe('clearCards', () => {
    it('offers an Undo toast that restores cards, history and metadata', async () => {
      useCollectionStore.setState({
        cards: [
          enriched({ copyId: 'a', scryfallId: 'sfA', importId: 'imp1' }),
          enriched({ copyId: 'b', scryfallId: 'sfB', importId: 'imp1' }),
        ],
        importHistory: [{ id: 'imp1', name: 'box.csv', count: 2, format: 'manabox', addedAt: 7 }],
        fileName: 'box.csv',
        scryfallHits: 2,
        detectedFormat: 'manabox',
        uploadedAt: 7,
      });

      await useCollectionStore.getState().clearCards();

      // Cleared in memory…
      expect(useCollectionStore.getState().cards).toEqual([]);
      expect(useCollectionStore.getState().importHistory).toEqual([]);
      // …and an Undo affordance was surfaced.
      const t = undoToast();
      expect(t?.message).toBe('Collection cleared.');

      t!.onAction!();
      await flush();

      const s = useCollectionStore.getState();
      expect(s.cards.map((c) => c.copyId).sort()).toEqual(['a', 'b']);
      expect(s.importHistory).toEqual([
        { id: 'imp1', name: 'box.csv', count: 2, format: 'manabox', addedAt: 7 },
      ]);
      expect(s.fileName).toBe('box.csv');
      expect(s.scryfallHits).toBe(2);
      expect(s.detectedFormat).toBe('manabox');
      expect(s.uploadedAt).toBe(7);
      // Restore persisted the rehydrated collection.
      expect(saveCollection).toHaveBeenCalled();
    });

    it('does not offer Undo when the collection was already empty', async () => {
      useCollectionStore.setState({ ...RESET });
      await useCollectionStore.getState().clearCards();
      expect(undoToast()).toBeUndefined();
    });

    it('re-derives deck allocations from the restored cards on undo', async () => {
      const restored = [enriched({ copyId: 'a', scryfallId: 'sfA', importId: 'imp1' })];
      useCollectionStore.setState({
        cards: restored,
        importHistory: [{ id: 'imp1', name: 'm', count: 1, format: '', addedAt: 1 }],
      });
      await useCollectionStore.getState().clearCards();

      const remapAllocations = vi.fn();
      useDecksStore.setState({
        decks: [{ id: 'd1' } as never],
        hydrated: true,
        remapAllocations,
      } as never);

      undoToast()!.onAction!();
      await flush();

      // The cross-entity self-heal: the decks store is asked to re-derive its
      // allocations against the exact cards we restored.
      expect(remapAllocations).toHaveBeenCalledTimes(1);
      expect(remapAllocations.mock.calls[0][0].map((c: { copyId: string }) => c.copyId)).toEqual([
        'a',
      ]);
    });

    it('restoreCollectionSnapshot (the Undo path itself) sets an honest error when the save fails', async () => {
      const restored = [enriched({ copyId: 'a', scryfallId: 'sfA', importId: 'imp1' })];
      useCollectionStore.setState({
        cards: restored,
        importHistory: [{ id: 'imp1', name: 'm', count: 1, format: '', addedAt: 1 }],
      });
      const snap = captureCollectionSnapshot(useCollectionStore.getState());
      useCollectionStore.setState({ cards: [], importHistory: [] });
      vi.mocked(saveCollection).mockRejectedValueOnce(new Error('quota exceeded'));

      await useCollectionStore.getState().restoreCollectionSnapshot(snap);

      // The restore itself still applied in memory…
      expect(useCollectionStore.getState().cards.map((c) => c.copyId)).toEqual(['a']);
      // …but the user is told it didn't durably persist.
      expect(useCollectionStore.getState().error).toMatch(/couldn't be saved locally/);
    });
  });

  describe('deleteImports', () => {
    it('offers an Undo toast counting removed cards and restores them', async () => {
      useCollectionStore.setState({
        cards: [
          enriched({ copyId: 'a', scryfallId: 'sfA', importId: 'imp1' }),
          enriched({ copyId: 'b', scryfallId: 'sfB', importId: 'imp1' }),
          enriched({ copyId: 'keep', scryfallId: 'sfK', importId: 'imp2' }),
        ],
        importHistory: [
          { id: 'imp1', name: 'one', count: 2, format: '', addedAt: 1 },
          { id: 'imp2', name: 'two', count: 1, format: '', addedAt: 2 },
        ],
      });

      await useCollectionStore.getState().deleteImports(['imp1']);

      expect(useCollectionStore.getState().cards.map((c) => c.copyId)).toEqual(['keep']);
      const t = undoToast();
      expect(t?.message).toBe('Removed 2 cards');

      t!.onAction!();
      await flush();

      expect(
        useCollectionStore
          .getState()
          .cards.map((c) => c.copyId)
          .sort()
      ).toEqual(['a', 'b', 'keep']);
      expect(useCollectionStore.getState().importHistory.map((h) => h.id)).toEqual([
        'imp1',
        'imp2',
      ]);
    });

    it('singularizes the message for a one-card import', async () => {
      useCollectionStore.setState({
        cards: [enriched({ copyId: 'a', scryfallId: 'sfA', importId: 'imp1' })],
        importHistory: [{ id: 'imp1', name: 'one', count: 1, format: '', addedAt: 1 }],
      });
      await useCollectionStore.getState().deleteImports(['imp1']);
      expect(undoToast()?.message).toBe('Removed 1 card');
    });

    it('offers no Undo when nothing matched the ids', async () => {
      useCollectionStore.setState({
        cards: [enriched({ copyId: 'a', scryfallId: 'sfA', importId: 'imp1' })],
        importHistory: [{ id: 'imp1', name: 'one', count: 1, format: '', addedAt: 1 }],
      });
      await useCollectionStore.getState().deleteImports(['nope']);
      expect(undoToast()).toBeUndefined();
    });
  });

  describe('importCards replace mode', () => {
    it('offers Undo when replacing a non-empty collection and restores the prior cards', async () => {
      const prior = enriched({ copyId: 'old', scryfallId: 'sfOld', importId: 'impOld' });
      useCollectionStore.setState({
        cards: [prior],
        importHistory: [{ id: 'impOld', name: 'old.csv', count: 1, format: '', addedAt: 1 }],
        fileName: 'old.csv',
      });

      const incoming = enriched({ copyId: 'new', scryfallId: 'sfNew' });
      await useCollectionStore
        .getState()
        .importCards(uploadResponse([incoming]), 'new.csv', 'replace');

      expect(useCollectionStore.getState().cards.map((c) => c.copyId)).toEqual(['new']);
      const t = undoToast();
      expect(t?.message).toBe('Collection replaced on import.');

      t!.onAction!();
      await flush();

      const s = useCollectionStore.getState();
      expect(s.cards.map((c) => c.copyId)).toEqual(['old']);
      expect(s.fileName).toBe('old.csv');
      expect(s.importHistory.map((h) => h.id)).toEqual(['impOld']);
    });

    it('offers no Undo for the first import into an empty collection', async () => {
      useCollectionStore.setState({ ...RESET });
      await useCollectionStore
        .getState()
        .importCards(
          uploadResponse([enriched({ copyId: 'x', scryfallId: 'sfX' })]),
          'f.csv',
          'replace'
        );
      expect(undoToast()).toBeUndefined();
    });

    it('offers no Undo for a merge import (additive, not destructive)', async () => {
      useCollectionStore.setState({
        cards: [enriched({ copyId: 'old', scryfallId: 'sfOld', importId: 'impOld' })],
        importHistory: [{ id: 'impOld', name: 'old.csv', count: 1, format: '', addedAt: 1 }],
      });
      await useCollectionStore
        .getState()
        .importCards(
          uploadResponse([enriched({ copyId: 'add', scryfallId: 'sfAdd' })]),
          'add.csv',
          'merge'
        );
      expect(undoToast()).toBeUndefined();
      expect(
        useCollectionStore
          .getState()
          .cards.map((c) => c.copyId)
          .sort()
      ).toEqual(['add', 'old']);
    });
  });
});
