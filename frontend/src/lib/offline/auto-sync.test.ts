// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoSyncOfflineData } from './auto-sync';
import { useOfflineStore } from '@/store/offline';
import type { OfflineManifest } from './types';

const LAST_CHECK_KEY = 'spellcontrol-offline-last-check';

function fakeManifest(): OfflineManifest {
  return {
    oracleVersion: 'v1',
    oracleCardCount: 100,
    oracleByteSize: 1_000_000,
    oracleUpdatedAt: Date.now(),
    combosVersion: 'c1',
    combosCount: 50,
    combosByteSize: 100_000,
    combosUpdatedAt: Date.now(),
  };
}

type StoreState = ReturnType<typeof useOfflineStore.getState>;

describe('autoSyncOfflineData', () => {
  let bootstrap: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let sync: ReturnType<typeof vi.fn<StoreState['sync']>>;
  let snapshot: StoreState;

  beforeEach(() => {
    snapshot = useOfflineStore.getState();
    bootstrap = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    sync = vi.fn<StoreState['sync']>().mockResolvedValue(undefined);
    useOfflineStore.setState(
      {
        ...snapshot,
        manifest: null,
        stats: null,
        progress: null,
        error: null,
        bootstrapped: false,
        bootstrap,
        sync,
      },
      true
    );
    localStorage.clear();
  });

  afterEach(() => {
    useOfflineStore.setState(snapshot, true);
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('bootstraps when the store has not hydrated yet', async () => {
    await autoSyncOfflineData();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('skips bootstrap when already hydrated', async () => {
    useOfflineStore.setState({ bootstrapped: true });
    await autoSyncOfflineData();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('triggers sync on the very first authed load (no manifest, no lastCheck)', async () => {
    await autoSyncOfflineData();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('triggers sync when the last manifest check was more than 24h ago', async () => {
    useOfflineStore.setState({
      bootstrapped: true,
      manifest: fakeManifest(),
      stats: { cardCount: 100, comboCount: 50 },
    });
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - 25 * 60 * 60 * 1000));
    await autoSyncOfflineData();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('skips sync when local data is populated and the last check is within 24h', async () => {
    useOfflineStore.setState({
      bootstrapped: true,
      manifest: fakeManifest(),
      stats: { cardCount: 100, comboCount: 50 },
    });
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - 60 * 60 * 1000));
    await autoSyncOfflineData();
    expect(sync).not.toHaveBeenCalled();
  });

  it('triggers sync when IDB was evicted (manifest survived but cardCount is 0)', async () => {
    // The iOS Safari ~14-day eviction signature: zustand still holds a
    // manifest from a previous session but the IDB cards/combos stores are
    // empty. Without this branch the staleness gate would happily skip a
    // re-download for up to 24h after the eviction.
    useOfflineStore.setState({
      bootstrapped: true,
      manifest: fakeManifest(),
      stats: { cardCount: 0, comboCount: 0 },
    });
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - 60 * 60 * 1000));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await autoSyncOfflineData();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('cache miss'));
    info.mockRestore();
  });

  it('logs a stale-cache notice (but not a cache-miss notice) when refreshing a populated cache', async () => {
    useOfflineStore.setState({
      bootstrapped: true,
      manifest: fakeManifest(),
      stats: { cardCount: 100, comboCount: 50 },
    });
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - 25 * 60 * 60 * 1000));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await autoSyncOfflineData();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('cache stale'));
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('cache miss'));
    info.mockRestore();
  });

  it('records the lastCheck timestamp after a successful sync', async () => {
    await autoSyncOfflineData();
    const stored = localStorage.getItem(LAST_CHECK_KEY);
    expect(stored).not.toBeNull();
    expect(Number(stored)).toBeGreaterThan(Date.now() - 1000);
  });

  it('does not record lastCheck when the sync throws', async () => {
    sync.mockRejectedValueOnce(new Error('boom'));
    await autoSyncOfflineData();
    expect(localStorage.getItem(LAST_CHECK_KEY)).toBeNull();
  });

  it('swallows bootstrap errors so the auth flow is never blocked', async () => {
    bootstrap.mockRejectedValueOnce(new Error('idb-dead'));
    await expect(autoSyncOfflineData()).resolves.toBeUndefined();
  });

  it('asks the browser for persistent storage when available', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persist }, onLine: true });
    await autoSyncOfflineData();
    expect(persist).toHaveBeenCalled();
  });

  it('tolerates browsers without navigator.storage.persist', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    await expect(autoSyncOfflineData()).resolves.toBeUndefined();
  });

  it('tolerates a broken localStorage (Safari private mode)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await expect(autoSyncOfflineData()).resolves.toBeUndefined();
    setItem.mockRestore();
  });
});
