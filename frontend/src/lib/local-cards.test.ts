import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoredCollection } from './local-cards';

// saveCollection fans the snapshot to three per-kind sync helpers; mock them so
// we can drive partial-failure without touching IndexedDB.
vi.mock('./sync', () => ({
  persistCardsState: vi.fn(),
  persistImportsState: vi.fn(),
  persistListsState: vi.fn(),
}));

import * as sync from './sync';
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
  beforeEach(() => vi.clearAllMocks());

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
