import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Per-panel queue of transient "+3" / "−5" chips that float up from the user's
 * tap and fade.
 *
 * Coalescing: a new push with the same sign as the most-recent live chip
 * within the coalesce window accumulates into that chip rather than spawning
 * a new one. The chip stays at its *original* anchor position so it doesn't
 * jump with each finger movement.
 */

export interface FloatingChip {
  id: number;
  value: number;
  x: number;
  y: number;
  expiresAt: number;
}

const LIFETIME_MS = 700;

export function useFloatingDelta(): {
  chips: FloatingChip[];
  push: (delta: number, x: number, y: number) => void;
} {
  const [chips, setChips] = useState<FloatingChip[]>([]);
  const idRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSweep = useCallback(() => {
    if (timerRef.current != null) return;
    timerRef.current = setTimeout(function sweep() {
      timerRef.current = null;
      const now = performance.now();
      setChips((prev) => prev.filter((c) => c.expiresAt > now));
    }, LIFETIME_MS + 20);
  }, []);

  const push = useCallback(
    (delta: number, x: number, y: number) => {
      if (delta === 0) return;
      const now = performance.now();
      setChips((prev) => {
        // Coalesce into the most recent live chip with the same sign.
        for (let i = prev.length - 1; i >= 0; i--) {
          const c = prev[i];
          if (c.expiresAt <= now) continue;
          if (Math.sign(c.value) === Math.sign(delta)) {
            const next = prev.slice();
            next[i] = { ...c, value: c.value + delta, expiresAt: now + LIFETIME_MS };
            return next;
          }
          break;
        }
        idRef.current += 1;
        return [...prev, { id: idRef.current, value: delta, x, y, expiresAt: now + LIFETIME_MS }];
      });
      scheduleSweep();
    },
    [scheduleSweep]
  );

  useEffect(
    () => () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    },
    []
  );

  return { chips, push };
}
