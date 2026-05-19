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
import { saveCollection, loadCollection, clearCollection } from '../lib/local-cards';
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
  importSheetOpen: false,
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

  it('back-fills a single history entry for collections saved before importHistory', async () => {
    await saveCollection({
      fileName: 'legacy.csv',
      cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 999,
      importHistory: [],
      lists: [],
    });
    await useCollectionStore.getState().hydrateCards();

    expect(useCollectionStore.getState().importHistory).toEqual([
      { name: 'legacy.csv', count: 1, format: '', addedAt: 999 },
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

  it('strips removed subCollection* legacy fields off loaded cards', async () => {
    const legacy = {
      ...enriched({ copyId: 'c1', scryfallId: 'sf1' }),
      subCollectionId: 'old',
      subCollectionKey: 'k',
    } as EnrichedCard;
    await saveCollection({
      fileName: 'x',
      cards: [legacy],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 1,
      importHistory: [{ id: 'i', name: 'x', count: 1, format: '', addedAt: 1 }],
      lists: [],
    });
    await useCollectionStore.getState().hydrateCards();
    const card = useCollectionStore.getState().cards[0] as unknown as Record<string, unknown>;
    expect('subCollectionId' in card).toBe(false);
    expect('subCollectionKey' in card).toBe(false);
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

  it('addCard appends a fresh copy from a Scryfall card and returns its copyId', async () => {
    const copyId = await useCollectionStore.getState().addCard(
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
    await useCollectionStore.getState().refreshPrices();
    expect(useCollectionStore.getState().error).toBe('rate limited');
    expect(useCollectionStore.getState().isRefreshingPrices).toBe(false);
  });

  it('sets an error when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    useCollectionStore.setState({ cards: [enriched({ copyId: 'c1', scryfallId: 'sf1' })] });
    await useCollectionStore.getState().refreshPrices();
    expect(useCollectionStore.getState().error).toBe('offline');
    expect(useCollectionStore.getState().isRefreshingPrices).toBe(false);
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
    g.setImportSheetOpen(true);
    g.setSearch('bolt');
    g.setLoading(true);
    g.setError('boom');
    const s = useCollectionStore.getState();
    expect(s.activeTab).toBe('tab-x');
    expect(s.editingBinder).toBe('b9');
    expect(s.importSheetOpen).toBe(true);
    expect(s.search).toBe('bolt');
    expect(s.isLoading).toBe(true);
    expect(s.error).toBe('boom');
  });
});

describe('persist migrate', () => {
  beforeEach(() => {
    localStorage.removeItem('spellcontrol');
  });

  async function rehydrateWith(version: number, state: unknown) {
    localStorage.setItem('spellcontrol', JSON.stringify({ state, version }));
    await useCollectionStore.persist.rehydrate();
  }

  it('wipes binders from a pre-v5 store', async () => {
    await rehydrateWith(4, { binders: [{ id: 'old', filter: {} }] });
    expect(useCollectionStore.getState().binders).toEqual([]);
  });

  it('runs the full v5 transform chain (filter→groups, capacity, pockets, sorts)', async () => {
    await rehydrateWith(5, {
      binders: [
        { id: 'a', filter: { x: 1 }, fixedPageCount: 2, pocketSize: 18, sorts: ['name'] },
        {
          id: 'b',
          fixedCapacity: 40,
          pocketSize: 24,
          sorts: [{ field: 'set', dir: 'asc' }],
        },
        { id: 'c', pocketSize: 9 },
      ],
    });
    // Every <15 store ultimately wipes binders; the value here is exercising
    // the intermediate v6/v8/v10/v11/v14 transform branches without throwing.
    expect(useCollectionStore.getState().binders).toEqual([]);
  });

  it('handles a v11 store: the non-array-sorts guard and the set→setReleaseDate map', async () => {
    await rehydrateWith(11, {
      binders: [
        { id: 'a', sorts: 'not-an-array' },
        { id: 'b', sorts: [{ field: 'set', dir: 'asc' }] },
      ],
    });
    expect(useCollectionStore.getState().binders).toEqual([]);
  });

  it('tolerates a null persisted state', async () => {
    await rehydrateWith(4, null);
    expect(Array.isArray(useCollectionStore.getState().binders)).toBe(true);
  });
});
