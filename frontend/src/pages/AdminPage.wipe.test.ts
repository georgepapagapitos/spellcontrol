// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { wipe } = vi.hoisted(() => ({ wipe: vi.fn(async () => {}) }));
vi.mock('@/lib/sync', () => ({ stopSyncAndWipeLocal: wipe }));

import { wipeThisDevice } from './AdminPage';

describe('wipeThisDevice', () => {
  beforeEach(() => {
    wipe.mockClear();
    localStorage.clear();
  });

  it('wipes through the sync layer (the real stores), clears localStorage, then reloads', async () => {
    const reload = vi.spyOn(location, 'reload').mockImplementation(() => {});
    localStorage.setItem('sc-theme', 'dark');

    await wipeThisDevice();

    expect(wipe).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sc-theme')).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    // Order matters: the reload must not race the wipe.
    expect(wipe.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
    reload.mockRestore();
  });
});
