// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as authApi from './auth-api';
import { startSync, stopSyncAndWipeLocal, flushSync } from './sync';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';

beforeEach(() => {
  vi.restoreAllMocks();
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
});

describe('startSync', () => {
  it('hydrates stores from the server snapshot', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'remote.csv',
        cards: [],
        scryfallHits: 0,
        scryfallMisses: 0,
        uploadedAt: 123,
        importHistory: [],
      },
      binders: [{ id: 'b1', name: 'Server binder' }],
      decks: [{ id: 'd1', name: 'Server deck' }],
      version: 3,
      updatedAt: 999,
    });
    await startSync();
    expect(useCollectionStore.getState().binders[0]).toMatchObject({ name: 'Server binder' });
    expect(useCollectionStore.getState().fileName).toBe('remote.csv');
    expect(useDecksStore.getState().decks[0]).toMatchObject({ name: 'Server deck' });
  });

  it('preserves local collection when the server snapshot is empty', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      version: 0,
      updatedAt: 0,
    });
    useCollectionStore.setState({ fileName: 'stale.csv', uploadedAt: 1 });
    await startSync();
    // Server is empty (new account / first login after auth). Local data should
    // be preserved and seeded up to the server rather than wiped.
    expect(useCollectionStore.getState().fileName).toBe('stale.csv');
    expect(useCollectionStore.getState().uploadedAt).toBe(1);
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

    await startSync();
    useCollectionStore.setState({ binders: [{ id: 'b9', name: 'New' } as never] });
    await flushSync();

    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersion: 4,
        binders: [{ id: 'b9', name: 'New' }],
      })
    );
  });

  it('on 409 conflict, applies the server snapshot and retries', async () => {
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
        binders: [{ id: 'remote' } as never],
        decks: [],
        version: 7,
        updatedAt: 100,
      },
    });
    const putSpy = vi
      .spyOn(authApi, 'putSync')
      .mockRejectedValueOnce(conflictErr)
      .mockResolvedValueOnce({ version: 8, updatedAt: 200 });

    await startSync();
    useCollectionStore.setState({ binders: [{ id: 'local' } as never] });
    await flushSync();
    // Wait for the retry that schedulePush kicks off.
    await new Promise((r) => setTimeout(r, 1700));

    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(putSpy.mock.calls[1][0].baseVersion).toBe(7);
  }, 5000);
});

describe('stopSyncAndWipeLocal', () => {
  it('clears stores and removes localStorage entries', async () => {
    localStorage.setItem('spellcontrol', '{"binders":[]}');
    localStorage.setItem('mtg-decks', '{"decks":[]}');
    useCollectionStore.setState({ binders: [{ id: 'x', name: 'leftover' } as never] });
    useDecksStore.setState({ decks: [{ id: 'y' }] as never });

    await stopSyncAndWipeLocal();

    expect(useCollectionStore.getState().binders).toEqual([]);
    expect(useDecksStore.getState().decks).toEqual([]);
    expect(localStorage.getItem('spellcontrol')).toBeNull();
    expect(localStorage.getItem('mtg-decks')).toBeNull();
  });
});
