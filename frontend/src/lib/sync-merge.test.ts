// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  mergeBinders,
  mergeDecks,
  mergeCollection,
  buildSyncMeta,
  loadSyncMeta,
  saveSyncMeta,
  setDirty,
  clearDirty,
  isDirty,
  type SyncMeta,
} from './sync-merge';
import type { BinderDef } from '../types';
import type { Deck } from '../store/decks';
import type { StoredCollection } from './local-cards';

function binder(overrides: Partial<BinderDef> = {}): BinderDef {
  return {
    id: 'b1',
    name: 'Test',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  } as BinderDef;
}

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function collection(overrides: Partial<StoredCollection> = {}): StoredCollection {
  return {
    fileName: 'test.csv',
    cards: [],
    scryfallHits: 0,
    scryfallMisses: 0,
    uploadedAt: 1000,
    importHistory: [],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('mergeBinders', () => {
  it('keeps newer local binder over older remote', () => {
    const local = [binder({ id: 'b1', name: 'Local', updatedAt: 2000 })];
    const remote = [binder({ id: 'b1', name: 'Remote', updatedAt: 1000 })];
    const result = mergeBinders(local, remote, null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Local');
  });

  it('keeps newer remote binder over older local', () => {
    const local = [binder({ id: 'b1', name: 'Local', updatedAt: 1000 })];
    const remote = [binder({ id: 'b1', name: 'Remote', updatedAt: 2000 })];
    const result = mergeBinders(local, remote, null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Remote');
  });

  it('prefers local when timestamps are equal', () => {
    const local = [binder({ id: 'b1', name: 'Local', updatedAt: 1000 })];
    const remote = [binder({ id: 'b1', name: 'Remote', updatedAt: 1000 })];
    const result = mergeBinders(local, remote, null);
    expect(result[0].name).toBe('Local');
  });

  it('adds new remote binder not known locally', () => {
    const local: BinderDef[] = [];
    const remote = [binder({ id: 'b-new', name: 'From Server' })];
    const result = mergeBinders(local, remote, null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('From Server');
  });

  it('keeps new local binder not on server', () => {
    const local = [binder({ id: 'b-new', name: 'New Local' })];
    const remote: BinderDef[] = [];
    const result = mergeBinders(local, remote, null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('New Local');
  });

  it('does not resurrect locally deleted binder', () => {
    const local: BinderDef[] = [];
    const remote = [binder({ id: 'b-deleted', name: 'Should Stay Dead' })];
    const meta: SyncMeta = {
      version: 1,
      binderIds: ['b-deleted'],
      deckIds: [],
      collectionUploadedAt: null,
    };
    const result = mergeBinders(local, remote, meta);
    expect(result).toHaveLength(0);
  });

  it('does not resurrect server-deleted binder', () => {
    const local = [binder({ id: 'b-gone', name: 'Deleted on Server' })];
    const remote: BinderDef[] = [];
    const meta: SyncMeta = {
      version: 1,
      binderIds: ['b-gone'],
      deckIds: [],
      collectionUploadedAt: null,
    };
    const result = mergeBinders(local, remote, meta);
    expect(result).toHaveLength(0);
  });

  it('renumbers positions after merge', () => {
    const local = [binder({ id: 'b1', position: 5, updatedAt: 2000 })];
    const remote = [
      binder({ id: 'b1', position: 0, updatedAt: 1000 }),
      binder({ id: 'b2', position: 1, updatedAt: 1000 }),
    ];
    const result = mergeBinders(local, remote, null);
    expect(result.map((b) => b.position)).toEqual([0, 1]);
  });
});

describe('mergeDecks', () => {
  it('keeps newer local deck', () => {
    const local = [deck({ id: 'd1', name: 'Local', updatedAt: 2000 })];
    const remote = [deck({ id: 'd1', name: 'Remote', updatedAt: 1000 })];
    const result = mergeDecks(local, remote, null);
    expect(result[0].name).toBe('Local');
  });

  it('keeps newer remote deck', () => {
    const local = [deck({ id: 'd1', name: 'Local', updatedAt: 1000 })];
    const remote = [deck({ id: 'd1', name: 'Remote', updatedAt: 2000 })];
    const result = mergeDecks(local, remote, null);
    expect(result[0].name).toBe('Remote');
  });

  it('does not resurrect locally deleted deck', () => {
    const local: Deck[] = [];
    const remote = [deck({ id: 'd-deleted' })];
    const meta: SyncMeta = {
      version: 1,
      binderIds: [],
      deckIds: ['d-deleted'],
      collectionUploadedAt: null,
    };
    const result = mergeDecks(local, remote, meta);
    expect(result).toHaveLength(0);
  });

  it('merges multiple decks from both sides', () => {
    const local = [
      deck({ id: 'd1', name: 'Local Only', updatedAt: 1000 }),
      deck({ id: 'd2', name: 'Shared Local', updatedAt: 2000 }),
    ];
    const remote = [
      deck({ id: 'd2', name: 'Shared Remote', updatedAt: 1500 }),
      deck({ id: 'd3', name: 'Remote Only', updatedAt: 1000 }),
    ];
    const result = mergeDecks(local, remote, null);
    expect(result).toHaveLength(3);
    expect(result.find((d) => d.id === 'd1')?.name).toBe('Local Only');
    expect(result.find((d) => d.id === 'd2')?.name).toBe('Shared Local');
    expect(result.find((d) => d.id === 'd3')?.name).toBe('Remote Only');
  });
});

describe('mergeCollection', () => {
  it('keeps newer local collection', () => {
    const local = collection({ uploadedAt: 2000, fileName: 'local.csv' });
    const remote = collection({ uploadedAt: 1000, fileName: 'remote.csv' });
    const result = mergeCollection(local, remote);
    expect(result?.fileName).toBe('local.csv');
  });

  it('keeps newer remote collection', () => {
    const local = collection({ uploadedAt: 1000, fileName: 'local.csv' });
    const remote = collection({ uploadedAt: 2000, fileName: 'remote.csv' });
    const result = mergeCollection(local, remote);
    expect(result?.fileName).toBe('remote.csv');
  });

  it('prefers local when timestamps are equal', () => {
    const local = collection({ uploadedAt: 1000, fileName: 'local.csv' });
    const remote = collection({ uploadedAt: 1000, fileName: 'remote.csv' });
    const result = mergeCollection(local, remote);
    expect(result?.fileName).toBe('local.csv');
  });

  it('returns remote when local is null', () => {
    const remote = collection({ fileName: 'remote.csv' });
    expect(mergeCollection(null, remote)?.fileName).toBe('remote.csv');
  });

  it('returns local when remote is null', () => {
    const local = collection({ fileName: 'local.csv' });
    expect(mergeCollection(local, null)?.fileName).toBe('local.csv');
  });

  it('returns null when both are null', () => {
    expect(mergeCollection(null, null)).toBeNull();
  });
});

describe('SyncMeta persistence', () => {
  it('round-trips through localStorage', () => {
    const meta: SyncMeta = {
      version: 5,
      binderIds: ['b1', 'b2'],
      deckIds: ['d1'],
      collectionUploadedAt: 12345,
    };
    saveSyncMeta(meta);
    const loaded = loadSyncMeta();
    expect(loaded).toEqual(meta);
  });

  it('returns null when nothing is stored', () => {
    expect(loadSyncMeta()).toBeNull();
  });
});

describe('dirty flag', () => {
  it('starts clean', () => {
    expect(isDirty()).toBe(false);
  });

  it('can be set and cleared', () => {
    setDirty();
    expect(isDirty()).toBe(true);
    clearDirty();
    expect(isDirty()).toBe(false);
  });
});

describe('buildSyncMeta', () => {
  it('captures entity IDs and collection timestamp', () => {
    const binders = [binder({ id: 'b1' }), binder({ id: 'b2' })];
    const decks = [deck({ id: 'd1' })];
    const coll = collection({ uploadedAt: 999 });
    const meta = buildSyncMeta(7, binders, decks, coll);
    expect(meta).toEqual({
      version: 7,
      binderIds: ['b1', 'b2'],
      deckIds: ['d1'],
      collectionUploadedAt: 999,
    });
  });

  it('handles null collection', () => {
    const meta = buildSyncMeta(1, [], [], null);
    expect(meta.collectionUploadedAt).toBeNull();
  });
});
