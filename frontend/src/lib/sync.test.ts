// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as authApi from './auth-api';
import { startSync, stopSyncAndWipeLocal, flushSync } from './sync';
import { markDestructive } from './sync-intent';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { usePlayStore } from '../store/play';

beforeEach(async () => {
  // Detach any subscribers and reset module-level sync state left by a
  // previous test before we start mocking the next one.
  await stopSyncAndWipeLocal();
  vi.restoreAllMocks();
  localStorage.clear();
  // Default: silent putSync; individual tests override.
  vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 1, updatedAt: 0 });
  useCollectionStore.setState({
    binders: [],
    cards: [],
    fileName: '',
    scryfallHits: 0,
    scryfallMisses: 0,
    uploadedAt: null,
    importHistory: [],
    hydrating: false,
  });
  useDecksStore.setState({ decks: [], hydrated: true });
  usePlayStore.setState({ history: [], local: null, hydrated: true });
});

describe('startSync', () => {
  it('overwrites stores with the server snapshot (no merge)', async () => {
    // Local has stale state that should be replaced wholesale.
    useCollectionStore.setState({
      binders: [
        { id: 'old', name: 'Local Stale', createdAt: 1, updatedAt: 1, position: 0 } as never,
      ],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'remote.csv',
        cards: [],
        scryfallHits: 0,
        scryfallMisses: 0,
        uploadedAt: 123,
        importHistory: [],
      },
      binders: [{ id: 'b1', name: 'Server binder', createdAt: 100, updatedAt: 100, position: 0 }],
      decks: [{ id: 'd1', name: 'Server deck', createdAt: 100, updatedAt: 100 }],
      version: 3,
      updatedAt: 999,
    });
    await startSync('user-1');
    expect(useCollectionStore.getState().binders).toHaveLength(1);
    expect(useCollectionStore.getState().binders[0]).toMatchObject({ name: 'Server binder' });
    expect(useCollectionStore.getState().fileName).toBe('remote.csv');
    expect(useDecksStore.getState().decks[0]).toMatchObject({ name: 'Server deck' });
  });

  it('pushes locally dirty state before overwriting from server', async () => {
    // Simulate: user deleted a binder pre-reload. Dirty flag survives reload.
    localStorage.setItem('spellcontrol-sync-dirty', '1');
    localStorage.setItem('spellcontrol-sync-base-version', '2');
    localStorage.setItem('spellcontrol-sync-owner', 'user-1');
    useCollectionStore.setState({ binders: [] });

    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 3, updatedAt: 100 });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      games: [],
      version: 3,
      updatedAt: 100,
    });

    await startSync('user-1');

    expect(putSpy).toHaveBeenCalledWith(expect.objectContaining({ baseVersion: 2, binders: [] }));
    expect(localStorage.getItem('spellcontrol-sync-dirty')).toBeNull();
  });

  it('wipes local state when the persisted owner differs from the current user', async () => {
    localStorage.setItem('spellcontrol-sync-owner', 'user-A');
    useCollectionStore.setState({
      binders: [{ id: 'b', name: 'A data', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [{ id: 'fresh', name: 'B data', createdAt: 2, updatedAt: 2, position: 0 }],
      decks: [],
      games: [],
      version: 1,
      updatedAt: 0,
    });

    await startSync('user-B');

    const binders = useCollectionStore.getState().binders;
    expect(binders).toHaveLength(1);
    expect(binders[0].id).toBe('fresh');
    expect(localStorage.getItem('spellcontrol-sync-owner')).toBe('user-B');
  });
});

describe('mutation flow', () => {
  it('destructive mutator triggers immediate push without waiting on the debounce', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [{ id: 'b1', name: 'Will be deleted', createdAt: 1, updatedAt: 1, position: 0 }],
      decks: [],
      games: [],
      version: 5,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 6, updatedAt: 100 });

    await startSync('user-1');
    expect(useCollectionStore.getState().binders).toHaveLength(1);

    // Delete the binder via the destructive mutator path.
    useCollectionStore.getState().deleteBinder('b1');

    // No timer wait: destructive ops should already have kicked the push.
    await new Promise((r) => setTimeout(r, 50));
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0][0]).toMatchObject({ baseVersion: 5, binders: [] });
  });

  it('clearCards triggers immediate push so a fast refresh cannot resurrect the collection', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'mine.csv',
        cards: [{ copyId: 'c1' }] as never,
        scryfallHits: 1,
        scryfallMisses: 0,
        uploadedAt: 1,
        importHistory: [],
      },
      binders: [],
      decks: [],
      games: [],
      version: 5,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 6, updatedAt: 100 });

    await startSync('user-1');
    expect(useCollectionStore.getState().cards).toHaveLength(1);

    await useCollectionStore.getState().clearCards();

    await new Promise((r) => setTimeout(r, 50));
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0][0]).toMatchObject({ baseVersion: 5, collection: null });
  });
});

describe('flushSync', () => {
  it('PUTs the current state with the tracked baseVersion', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      version: 4,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 5, updatedAt: 100 });

    await startSync('user-1');
    useCollectionStore.setState({
      binders: [{ id: 'b9', name: 'New', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    await flushSync();
    await new Promise((r) => setTimeout(r, 50));

    expect(putSpy).toHaveBeenCalled();
    const firstCall = putSpy.mock.calls[0][0];
    expect(firstCall).toMatchObject({ baseVersion: 4 });
    expect(firstCall.binders).toEqual([expect.objectContaining({ id: 'b9', name: 'New' })]);
  });

  it('on 409 conflict, re-bases on the server version and retries with local state', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      version: 0,
      updatedAt: 0,
    });
    const conflictErr = Object.assign(new Error('conflict'), {
      status: 409,
      current: {
        collection: null,
        binders: [{ id: 'remote', createdAt: 100, updatedAt: 100, position: 0 } as never],
        decks: [],
        version: 7,
        updatedAt: 100,
      },
    });
    const putSpy = vi
      .spyOn(authApi, 'putSync')
      .mockRejectedValueOnce(conflictErr)
      .mockResolvedValueOnce({ version: 8, updatedAt: 200 });

    await startSync('user-1');
    markDestructive();
    useCollectionStore.setState({
      binders: [{ id: 'local', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    await flushSync();
    // Allow retry kicked off after the 409 to settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(putSpy.mock.calls[1][0].baseVersion).toBe(7);
    expect(putSpy.mock.calls[1][0].binders).toEqual([expect.objectContaining({ id: 'local' })]);
  });
});

describe('stopSyncAndWipeLocal', () => {
  it('clears stores and removes localStorage entries', async () => {
    localStorage.setItem('spellcontrol', '{"binders":[]}');
    localStorage.setItem('mtg-decks', '{"decks":[]}');
    localStorage.setItem('spellcontrol-sync-meta', '{}');
    localStorage.setItem('spellcontrol-sync-dirty', '1');
    localStorage.setItem('spellcontrol-sync-owner', 'user-1');
    localStorage.setItem('spellcontrol-sync-base-version', '5');
    useCollectionStore.setState({
      binders: [{ id: 'x', name: 'leftover', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    useDecksStore.setState({ decks: [{ id: 'y' }] as never });

    await stopSyncAndWipeLocal();

    expect(useCollectionStore.getState().binders).toEqual([]);
    expect(useDecksStore.getState().decks).toEqual([]);
    expect(localStorage.getItem('spellcontrol')).toBeNull();
    expect(localStorage.getItem('mtg-decks')).toBeNull();
    expect(localStorage.getItem('spellcontrol-sync-meta')).toBeNull();
    expect(localStorage.getItem('spellcontrol-sync-dirty')).toBeNull();
    expect(localStorage.getItem('spellcontrol-sync-owner')).toBeNull();
    expect(localStorage.getItem('spellcontrol-sync-base-version')).toBeNull();
  });
});
