// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPwa } from './register-pwa';

function stubServiceWorker(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('registerPwa', () => {
  it('unregisters any prior SW and clears its caches (PWA retired)', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }, { unregister }]);
    stubServiceWorker({ getRegistrations });
    const cacheDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['workbox-precache-v1', 'runtime']),
      delete: cacheDelete,
    });

    await expect(registerPwa()).resolves.toBeUndefined();

    expect(getRegistrations).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(cacheDelete).toHaveBeenCalledWith('workbox-precache-v1');
    expect(cacheDelete).toHaveBeenCalledWith('runtime');
  });

  it('is a no-op once no service worker remains', async () => {
    const getRegistrations = vi.fn().mockResolvedValue([]);
    stubServiceWorker({ getRegistrations });
    const cacheDelete = vi.fn();
    vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue([]), delete: cacheDelete });

    await expect(registerPwa()).resolves.toBeUndefined();

    expect(cacheDelete).not.toHaveBeenCalled();
  });

  it('swallows teardown failures — cleanup must never block boot', async () => {
    stubServiceWorker({ getRegistrations: vi.fn().mockRejectedValue(new Error('nope')) });
    await expect(registerPwa()).resolves.toBeUndefined();
  });
});
