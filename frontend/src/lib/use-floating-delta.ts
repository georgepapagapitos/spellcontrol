import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Per-panel "running burst" chip that shows the net life change while the
 * user is tapping quickly. Consecutive taps within the burst window
 * accumulate (signed) into a single chip — tap +, +, +, − reads as
 * "+1 → +2 → +3 → +2" — and the chip clears `LIFETIME_MS` after the last
 * tap.
 */

export interface FloatingChip {
  id: number;
  value: number;
  x: number;
  y: number;
  expiresAt: number;
}

const LIFETIME_MS = 1500;

export function useFloatingDelta(): {
  chips: FloatingChip[];
  push: (delta: number, x: number, y: number) => void;
} {
  const [chips, setChips] = useState<FloatingChip[]>([]);
  const idRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback((delta: number, x: number, y: number) => {
    if (delta === 0) return;
    const now = performance.now();
    setChips((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const c = prev[i];
        if (c.expiresAt <= now) continue;
        const next = prev.slice();
        next[i] = { ...c, value: c.value + delta, expiresAt: now + LIFETIME_MS };
        return next;
      }
      idRef.current += 1;
      return [...prev, { id: idRef.current, value: delta, x, y, expiresAt: now + LIFETIME_MS }];
    });
    // Single rescheduling timer: each push pushes the sweep further out so
    // it always fires LIFETIME_MS after the *last* tap. No side effects
    // inside the setChips updater (which would double-fire under StrictMode).
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const sweepNow = performance.now();
      setChips((prev) => prev.filter((c) => c.expiresAt > sweepNow));
    }, LIFETIME_MS + 20);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    },
    []
  );

  return { chips, push };
}
