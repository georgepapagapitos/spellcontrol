import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DownloadProgress, OfflineManifest } from '@/lib/offline';

vi.mock('@/lib/offline', () => ({
  clearOfflineData: vi.fn(),
  getOfflineDataStats: vi.fn(),
  readOfflineManifest: vi.fn(),
  syncOfflineData: vi.fn(),
}));

import {
  clearOfflineData,
  getOfflineDataStats,
  readOfflineManifest,
  syncOfflineData,
} from '@/lib/offline';
import { useOfflineStore, offlineDataAvailable } from './offline';

const mockClear = vi.mocked(clearOfflineData);
const mockStats = vi.mocked(getOfflineDataStats);
const mockManifest = vi.mocked(readOfflineManifest);
const mockSync = vi.mocked(syncOfflineData);

function manifest(oracleCardCount: number): OfflineManifest {
  return {
    oracleVersion: 'v1',
    oracleCardCount,
    oracleByteSize: 1000,
    oracleUpdatedAt: 1,
    combosVersion: 'c1',
    combosCount: 5,
    combosByteSize: 100,
    combosUpdatedAt: 1,
  };
}

function resetStore() {
  useOfflineStore.setState({
    manifest: null,
    stats: null,
    progress: null,
    error: null,
    bootstrapped: false,
  });
}

describe('useOfflineStore — bootstrap', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('loads the manifest and stats from IDB', async () => {
    mockManifest.mockResolvedValue(manifest(100));
    mockStats.mockResolvedValue({ cardCount: 100, comboCount: 5 });
    await useOfflineStore.getState().bootstrap();
    const s = useOfflineStore.getState();
    expect(s.bootstrapped).toBe(true);
    expect(s.manifest?.oracleCardCount).toBe(100);
    expect(s.stats).toEqual({ cardCount: 100, comboCount: 5 });
  });

  it('only runs once — a second call is a no-op', async () => {
    mockManifest.mockResolvedValue(null);
    mockStats.mockResolvedValue({ cardCount: 0, comboCount: 0 });
    await useOfflineStore.getState().bootstrap();
    await useOfflineStore.getState().bootstrap();
    expect(mockManifest).toHaveBeenCalledOnce();
  });

  it('still marks bootstrapped and records the error on failure', async () => {
    mockManifest.mockRejectedValue(new Error('idb broken'));
    mockStats.mockResolvedValue({ cardCount: 0, comboCount: 0 });
    await useOfflineStore.getState().bootstrap();
    const s = useOfflineStore.getState();
    expect(s.bootstrapped).toBe(true);
    expect(s.error).toBe('idb broken');
  });
});

describe('useOfflineStore — sync', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('downloads, refreshes stats, and reports done', async () => {
    const progressSeen: DownloadProgress[] = [];
    mockSync.mockImplementation(async ({ onProgress }) => {
      onProgress?.({ phase: 'downloading-cards', fraction: 0.5 });
      return { manifest: manifest(200), updated: true };
    });
    mockStats.mockResolvedValue({ cardCount: 200, comboCount: 9 });
    // Watch progress transitions.
    const unsub = useOfflineStore.subscribe((s) => {
      if (s.progress) progressSeen.push(s.progress);
    });
    await useOfflineStore.getState().sync();
    unsub();
    const s = useOfflineStore.getState();
    expect(s.manifest?.oracleCardCount).toBe(200);
    expect(s.stats).toEqual({ cardCount: 200, comboCount: 9 });
    expect(s.progress).toEqual({ phase: 'done', fraction: 1 });
    expect(progressSeen.some((p) => p.phase === 'downloading-cards')).toBe(true);
  });

  it('forwards the force option to syncOfflineData', async () => {
    mockSync.mockResolvedValue({ manifest: manifest(1), updated: true });
    mockStats.mockResolvedValue({ cardCount: 1, comboCount: 0 });
    await useOfflineStore.getState().sync({ force: true });
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it('records an error and an error phase when the sync fails', async () => {
    mockSync.mockRejectedValue(new Error('network'));
    await useOfflineStore.getState().sync();
    const s = useOfflineStore.getState();
    expect(s.error).toBe('network');
    expect(s.progress).toEqual({ phase: 'error', fraction: null });
  });
});

describe('useOfflineStore — clear', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('wipes the local data and zeroes the counts', async () => {
    useOfflineStore.setState({ manifest: manifest(50), error: 'stale' });
    mockClear.mockResolvedValue(undefined);
    await useOfflineStore.getState().clear();
    const s = useOfflineStore.getState();
    expect(mockClear).toHaveBeenCalledOnce();
    expect(s.manifest).toBeNull();
    expect(s.stats).toEqual({ cardCount: 0, comboCount: 0 });
    expect(s.error).toBeNull();
  });
});

describe('offlineDataAvailable', () => {
  it('is false with no manifest', () => {
    expect(offlineDataAvailable({ manifest: null } as never)).toBe(false);
  });

  it('is false when the manifest has zero cards', () => {
    expect(offlineDataAvailable({ manifest: manifest(0) } as never)).toBe(false);
  });

  it('is true when the manifest has cards', () => {
    expect(offlineDataAvailable({ manifest: manifest(1) } as never)).toBe(true);
  });
});
