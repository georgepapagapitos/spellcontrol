import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAppCaches, resetAppCacheAndReload } from './reset-app-cache';

interface FakeReg {
  unregister(): Promise<boolean>;
}

function installFakeCaches(keys: string[], opts: { deleteFails?: Set<string> } = {}) {
  const deleted: string[] = [];
  (globalThis as typeof globalThis & { caches?: unknown }).caches = {
    keys: vi.fn().mockResolvedValue(keys),
    delete: vi.fn(async (k: string) => {
      if (opts.deleteFails?.has(k)) throw new Error('cache delete failed');
      deleted.push(k);
      return true;
    }),
  } as unknown as CacheStorage;
  return { deleted };
}

function installFakeServiceWorker(regs: FakeReg[], opts: { getRegistrationsFails?: boolean } = {}) {
  const original = (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer })
    .serviceWorker;
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistrations: vi.fn(async () => {
        if (opts.getRegistrationsFails) throw new Error('getRegistrations failed');
        return regs;
      }),
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: original,
      });
    } else {
      // @ts-expect-error — restoring missing property.
      delete navigator.serviceWorker;
    }
  };
}

afterEach(() => {
  // @ts-expect-error — cleaning up the test global.
  delete globalThis.caches;
  vi.restoreAllMocks();
});

describe('clearAppCaches', () => {
  it('deletes every cache key and reports the count', async () => {
    installFakeCaches(['app-shell-v1', 'scryfall-images', 'tagger-tags']);
    const restoreSW = installFakeServiceWorker([]);

    const result = await clearAppCaches();
    expect(result.cachesCleared).toBe(3);
    expect(result.serviceWorkersUnregistered).toBe(0);

    restoreSW();
  });

  it('counts only successful deletions when some throw', async () => {
    installFakeCaches(['ok-1', 'broken', 'ok-2'], { deleteFails: new Set(['broken']) });
    const restoreSW = installFakeServiceWorker([]);
    const result = await clearAppCaches();
    expect(result.cachesCleared).toBe(2);
    restoreSW();
  });

  it('unregisters every active service worker', async () => {
    installFakeCaches([]);
    const a: FakeReg = { unregister: vi.fn().mockResolvedValue(true) };
    const b: FakeReg = { unregister: vi.fn().mockResolvedValue(true) };
    const restoreSW = installFakeServiceWorker([a, b]);

    const result = await clearAppCaches();
    expect(a.unregister).toHaveBeenCalled();
    expect(b.unregister).toHaveBeenCalled();
    expect(result.serviceWorkersUnregistered).toBe(2);

    restoreSW();
  });

  it('swallows getRegistrations errors but still reports successful cache clears', async () => {
    installFakeCaches(['app-shell-v1']);
    const restoreSW = installFakeServiceWorker([], { getRegistrationsFails: true });
    const result = await clearAppCaches();
    expect(result.cachesCleared).toBe(1);
    expect(result.serviceWorkersUnregistered).toBe(0);
    restoreSW();
  });

  it('returns zeros when neither caches nor serviceWorker are available', async () => {
    const result = await clearAppCaches();
    expect(result).toEqual({ cachesCleared: 0, serviceWorkersUnregistered: 0 });
  });
});

describe('resetAppCacheAndReload', () => {
  it('clears caches and invokes the reload callback', async () => {
    installFakeCaches(['app-shell']);
    const restoreSW = installFakeServiceWorker([]);
    const reload = vi.fn();
    const result = await resetAppCacheAndReload(reload);
    expect(result.cachesCleared).toBe(1);
    expect(reload).toHaveBeenCalledTimes(1);
    restoreSW();
  });
});
