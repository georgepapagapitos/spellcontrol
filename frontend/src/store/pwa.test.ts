import { describe, it, expect, vi } from 'vitest';
import { usePwaStore } from './pwa';

describe('usePwaStore', () => {
  it('starts with no update available', () => {
    expect(usePwaStore.getState().updateAvailable).toBe(false);
  });

  it('setPending flags an available update', () => {
    usePwaStore.getState().setPending(() => {});
    expect(usePwaStore.getState().updateAvailable).toBe(true);
    // Drain so the module-level pending apply does not leak into other tests.
    return usePwaStore.getState().applyPendingUpdate();
  });

  it('applyPendingUpdate runs the deferred apply and clears the flag', async () => {
    const apply = vi.fn();
    usePwaStore.getState().setPending(apply);
    await usePwaStore.getState().applyPendingUpdate();
    expect(apply).toHaveBeenCalledOnce();
    expect(usePwaStore.getState().updateAvailable).toBe(false);
  });

  it('awaits an async apply callback', async () => {
    let resolved = false;
    usePwaStore.getState().setPending(async () => {
      await Promise.resolve();
      resolved = true;
    });
    await usePwaStore.getState().applyPendingUpdate();
    expect(resolved).toBe(true);
  });

  it('applyPendingUpdate is a no-op when nothing is pending', async () => {
    // Nothing pending after the previous drain — must not throw.
    await usePwaStore.getState().applyPendingUpdate();
    expect(usePwaStore.getState().updateAvailable).toBe(false);
  });

  it('runs the apply callback only once across repeated calls', async () => {
    const apply = vi.fn();
    usePwaStore.getState().setPending(apply);
    await usePwaStore.getState().applyPendingUpdate();
    await usePwaStore.getState().applyPendingUpdate();
    expect(apply).toHaveBeenCalledOnce();
  });
});
