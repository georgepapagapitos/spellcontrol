// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNativePlatform } from '@/lib/platform';
import { reconcileNativeBundle, registerPwa } from './register-pwa';

vi.mock('@/lib/platform', () => ({ isNativePlatform: vi.fn() }));

const mockedIsNative = vi.mocked(isNativePlatform);

const BUILD_ID_KEY = 'spellcontrol-build-id';

function stubServiceWorker(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value });
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore — some tests intentionally break localStorage
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('registerPwa', () => {
  it('on native first boot (no stored id), unregisters SWs, clears caches, and persists the new id', async () => {
    mockedIsNative.mockReturnValue(true);
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }, { unregister }]);
    stubServiceWorker({ getRegistrations });
    const cacheDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['workbox-precache-v1', 'runtime']),
      delete: cacheDelete,
    });

    await registerPwa();

    expect(getRegistrations).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(cacheDelete).toHaveBeenCalledWith('workbox-precache-v1');
    expect(cacheDelete).toHaveBeenCalledWith('runtime');
    // The stubbed vitest build id (see vitest.config.ts `define`) is now stored.
    expect(localStorage.getItem(BUILD_ID_KEY)).toBe('test-build-id');
  });

  it('on native, swallows teardown failures', async () => {
    mockedIsNative.mockReturnValue(true);
    stubServiceWorker({ getRegistrations: vi.fn().mockRejectedValue(new Error('nope')) });
    await expect(registerPwa()).resolves.toBeUndefined();
  });

  it('on web, does not tear down service workers', async () => {
    mockedIsNative.mockReturnValue(false);
    const getRegistrations = vi.fn();
    stubServiceWorker({ getRegistrations });
    // `virtual:pwa-register` is unresolved under Vitest, so registerPwa
    // returns via its import catch — it must not touch the SW registry.
    await expect(registerPwa()).resolves.toBeUndefined();
    expect(getRegistrations).not.toHaveBeenCalled();
  });
});

describe('reconcileNativeBundle', () => {
  it('first boot (no stored id) nukes SWs + caches and writes the id', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    stubServiceWorker({ getRegistrations });
    const cacheDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['precache']),
      delete: cacheDelete,
    });

    await reconcileNativeBundle('build-A');

    expect(getRegistrations).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
    expect(cacheDelete).toHaveBeenCalledWith('precache');
    expect(localStorage.getItem(BUILD_ID_KEY)).toBe('build-A');
  });

  it('matching stored id leaves SWs and caches alone', async () => {
    localStorage.setItem(BUILD_ID_KEY, 'build-A');
    const getRegistrations = vi.fn();
    stubServiceWorker({ getRegistrations });
    const cacheDelete = vi.fn();
    vi.stubGlobal('caches', { keys: vi.fn(), delete: cacheDelete });

    await reconcileNativeBundle('build-A');

    expect(getRegistrations).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(localStorage.getItem(BUILD_ID_KEY)).toBe('build-A');
  });

  it('differing stored id nukes and writes the new id', async () => {
    localStorage.setItem(BUILD_ID_KEY, 'build-A');
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    stubServiceWorker({ getRegistrations });
    const cacheDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['old-precache']),
      delete: cacheDelete,
    });

    await reconcileNativeBundle('build-B');

    expect(getRegistrations).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
    expect(cacheDelete).toHaveBeenCalledWith('old-precache');
    expect(localStorage.getItem(BUILD_ID_KEY)).toBe('build-B');
  });

  it('localStorage read throwing is treated as no-prior-id (nuke + try-write)', async () => {
    // happy-dom's localStorage doesn't reliably go through Storage.prototype,
    // so stub the global directly with a throwing implementation.
    const getItem = vi.fn(() => {
      throw new Error('SecurityError');
    });
    const setItem = vi.fn(() => {
      throw new Error('QuotaExceeded');
    });
    vi.stubGlobal('localStorage', {
      getItem,
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    } satisfies Storage);
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    stubServiceWorker({ getRegistrations });
    const cacheDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['precache']),
      delete: cacheDelete,
    });

    await expect(reconcileNativeBundle('build-C')).resolves.toBeUndefined();
    expect(getItem).toHaveBeenCalledWith(BUILD_ID_KEY);
    expect(setItem).toHaveBeenCalledWith(BUILD_ID_KEY, 'build-C');
    expect(getRegistrations).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
  });
});
