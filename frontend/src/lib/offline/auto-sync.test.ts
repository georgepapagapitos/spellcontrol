// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoSyncOfflineData, registerOfflineSyncOnResume } from './auto-sync';
import { useOfflineStore } from '@/store/offline';
import type { OfflineManifest } from './types';

vi.mock('@/lib/platform', () => ({
  isNativePlatform: vi.fn(() => true),
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));

const platform = await import('@/lib/platform');
const isNativePlatform = vi.mocked(platform.isNativePlatform);

const capacitorApp = await import('@capacitor/app');
const addListener = vi.mocked(capacitorApp.App.addListener);

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
    isNativePlatform.mockReturnValue(true);
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

  it('triggers sync when the last manifest check is older than the recheck interval', async () => {
    useOfflineStore.setState({
      bootstrapped: true,
      manifest: fakeManifest(),
      stats: { cardCount: 100, comboCount: 50 },
    });
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - 4 * 60 * 60 * 1000));
    await autoSyncOfflineData();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('skips sync when local data is populated and the last check is recent', async () => {
    useOfflineStore.setState({
      bootstrapped: true,
      manifest: fakeManifest(),
      stats: { cardCount: 100, comboCount: 50 },
    });
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - 30 * 60 * 1000));
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
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - 4 * 60 * 60 * 1000));
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

  describe('web platform gate', () => {
    beforeEach(() => {
      isNativePlatform.mockReturnValue(false);
    });

    it('skips everything on web (no bootstrap, no sync, no persistent-storage ask)', async () => {
      const persist = vi.fn().mockResolvedValue(true);
      vi.stubGlobal('navigator', { storage: { persist }, onLine: true });
      await autoSyncOfflineData();
      expect(bootstrap).not.toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
      expect(localStorage.getItem(LAST_CHECK_KEY)).toBeNull();
    });
  });

  describe('registerOfflineSyncOnResume', () => {
    beforeEach(() => {
      addListener.mockClear();
      addListener.mockResolvedValue({ remove: vi.fn() } as never);
    });

    it('does not register a listener on web', () => {
      isNativePlatform.mockReturnValue(false);
      const cleanup = registerOfflineSyncOnResume();
      expect(addListener).not.toHaveBeenCalled();
      expect(() => cleanup()).not.toThrow();
    });

    it('registers a resume listener on native', () => {
      registerOfflineSyncOnResume();
      expect(addListener).toHaveBeenCalledWith('resume', expect.any(Function));
    });

    it('re-runs the offline sync when the app resumes', async () => {
      useOfflineStore.setState({ bootstrapped: true });
      registerOfflineSyncOnResume();
      const resumeCb = addListener.mock.calls[0][1] as () => void;
      resumeCb();
      await vi.waitFor(() => expect(sync).toHaveBeenCalled());
    });

    it('removes the listener on cleanup', async () => {
      const remove = vi.fn();
      addListener.mockResolvedValueOnce({ remove } as never);
      const cleanup = registerOfflineSyncOnResume();
      cleanup();
      await vi.waitFor(() => expect(remove).toHaveBeenCalled());
    });
  });
});
