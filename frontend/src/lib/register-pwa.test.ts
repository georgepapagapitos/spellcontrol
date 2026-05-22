// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNativePlatform } from '@/lib/platform';
import { registerPwa } from './register-pwa';

vi.mock('@/lib/platform', () => ({ isNativePlatform: vi.fn() }));

const mockedIsNative = vi.mocked(isNativePlatform);

function stubServiceWorker(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('registerPwa', () => {
  it('on native, unregisters existing service workers and clears caches', async () => {
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
