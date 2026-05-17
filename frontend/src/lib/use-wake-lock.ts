import { useEffect } from 'react';

/**
 * Hold a screen Wake Lock while `active` is true so the device doesn't dim
 * or sleep mid-game (a real pain point at a physical table where the phone
 * sits untouched between turns).
 *
 * The lock is auto-released by the platform when the tab is hidden, so we
 * re-acquire on `visibilitychange`. Feature-detected and a silent no-op on
 * browsers without the API (older Safari) — the game still works, the
 * screen just sleeps on its normal timer.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await nav.wakeLock!.request('screen');
        if (cancelled) {
          void lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
      } catch {
        // Rejected (e.g. not visible, low battery) — best effort, ignore.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel) void sentinel.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
