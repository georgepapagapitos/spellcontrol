import { useEffect, useRef, useState } from 'react';

/**
 * Tween a displayed integer toward a target value over ~200ms using rAF.
 * - Always re-targets the in-flight animation (never queues); this prevents
 *   the displayed number lagging real life under rapid taps.
 * - Snaps to the target immediately if the jump is >5, since for big swings
 *   the user wants to see the answer, not a long count-up.
 * - `popKey` increments every time the target changes so callers can drive
 *   a one-shot pop animation by remounting via key or watching the value.
 */
export function useAnimatedNumber(
  target: number,
  durationMs = 200
): { display: number; popKey: number } {
  const [display, setDisplay] = useState<number>(target);
  const [popKey, setPopKey] = useState<number>(0);
  const displayRef = useRef<number>(target);
  const rafRef = useRef<number | null>(null);
  const tweenRef = useRef<{ from: number; to: number; t0: number } | null>(null);
  const lastTargetRef = useRef<number>(target);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (target === lastTargetRef.current) return;
    lastTargetRef.current = target;
    setPopKey((k) => k + 1);

    const current = displayRef.current;
    if (Math.abs(target - current) > 5) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      tweenRef.current = null;
      setDisplay(target);
      return;
    }

    tweenRef.current = { from: current, to: target, t0: performance.now() };
    if (rafRef.current != null) return;

    const tick = (now: number) => {
      const s = tweenRef.current;
      if (!s) {
        rafRef.current = null;
        return;
      }
      const elapsed = now - s.t0;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const value = Math.round(s.from + (s.to - s.from) * eased);
      setDisplay(value);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        tweenRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [target, durationMs]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  return { display, popKey };
}
