import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoredCollection } from './local-cards';

// saveCollection fans the snapshot to three per-kind sync helpers; mock them so
// we can drive partial-failure without touching IndexedDB.
vi.mock('./', () => ({
  persistCardsState: vi.fn(),
  persistImportsState: vi.fn(),
  persistListsState: vi.fn(),
}));

// The store, reduced to the one flag saveCollection gates on, with a switch
// the tests flip to simulate the IndexedDB hydrate finishing.
let storeHydrating = false;
const storeListeners = new Set<(s: { hydrating: boolean }) => void>();
function finishHydration() {
  storeHydrating = false;
  for (const l of storeListeners) l({ hydrating: false });
}
vi.mock('@/store/collection', () => ({
  useCollectionStore: {
    getState: () => ({ hydrating: storeHydrating }),
    subscribe: (listener: (s: { hydrating: boolean }) => void) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
  },
}));

import * as sync from './';
import { saveCollection, SaveCollectionError } from './local-cards';

const data: StoredCollection = {
  fileName: 'x.csv',
  cards: [],
  scryfallHits: 0,
  scryfallMisses: 0,
  uploadedAt: 0,
  importHistory: [],
  lists: [],
};

describe('saveCollection (F25)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeHydrating = false;
    storeListeners.clear();
  });

  it('resolves when every kind persists', async () => {
    vi.mocked(sync.persistCardsState).mockResolvedValue();
    vi.mocked(sync.persistImportsState).mockResolvedValue();
    vi.mocked(sync.persistListsState).mockResolvedValue();
    await expect(saveCollection(data)).resolves.toBeUndefined();
  });

  it('throws SaveCollectionError naming only the failed kind (cards still saved)', async () => {
    vi.mocked(sync.persistCardsState).mockResolvedValue();
    vi.mocked(sync.persistImportsState).mockRejectedValue(new Error('idb write failed'));
    vi.mocked(sync.persistListsState).mockResolvedValue();
    // cards persisted fine — the error must NOT implicate cards (would trigger
    // the misleading "will be lost" toast).
    await expect(saveCollection(data)).rejects.toBeInstanceOf(SaveCollectionError);
    await expect(saveCollection(data)).rejects.toMatchObject({ kinds: ['imports'] });
  });

  it('still attempts all kinds even if the first rejects', async () => {
    vi.mocked(sync.persistCardsState).mockRejectedValue(new Error('boom'));
    vi.mocked(sync.persistImportsState).mockResolvedValue();
    vi.mocked(sync.persistListsState).mockResolvedValue();
    await expect(saveCollection(data)).rejects.toMatchObject({ kinds: ['cards'] });
    expect(sync.persistImportsState).toHaveBeenCalled();
    expect(sync.persistListsState).toHaveBeenCalled();
  });
});

describe('saveCollection before the store has hydrated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeListeners.clear();
    vi.mocked(sync.persistCardsState).mockResolvedValue();
    vi.mocked(sync.persistImportsState).mockResolvedValue();
    vi.mocked(sync.persistListsState).mockResolvedValue();
  });

  it('writes nothing until hydration finishes, then persists', async () => {
    storeHydrating = true;
    let settled = false;
    const pending = saveCollection(data).then(() => {
      settled = true;
    });
    // Give the gate every chance to (wrongly) fall through.
    await new Promise((r) => setTimeout(r, 0));
    expect(sync.persistCardsState).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    finishHydration();
    await pending;
    expect(sync.persistCardsState).toHaveBeenCalledTimes(1);
    expect(settled).toBe(true);
  });

  it('drops its subscription once hydration lands', async () => {
    storeHydrating = true;
    const pending = saveCollection(data);
    await new Promise((r) => setTimeout(r, 0));
    expect(storeListeners.size).toBe(1);
    finishHydration();
    await pending;
    expect(storeListeners.size).toBe(0);
  });
});
