import { useEffect, useRef, useState } from 'react';

export interface AnimatedNumberOpts {
  durationMs?: number;
  revealMs?: number;
  /**
   * Session-scoped reveal key. When provided, the hook plays a 0→target
   * reveal tween the FIRST time this key is seen (across all hook instances,
   * including remounts). Pass null/undefined to skip the reveal entirely.
   *
   * Semantics:
   *  - null/undefined: no reveal; display tracks target immediately.
   *  - string: reveal fires once globally per key, even across unmount/remount.
   *
   * Legacy positional/number signature is unchanged (GameBoard untouched).
   */
  revealKey?: string | null;
}

/** Module-level set of already-consumed reveal keys. Prevents remount replay. */
export const consumedRevealKeys = new Set<string>();

/** Test-only reset — call in beforeEach to isolate test state. */
export function __resetRevealRegistryForTests(): void {
  consumedRevealKeys.clear();
}

function isReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Tween a displayed integer toward a target value.
 *
 * Legacy signature (back-compat with GameBoard):
 *   useAnimatedNumber(target, 200) — no reveal, snaps on |Δ|>5
 *   useAnimatedNumber(target)      — same, default 200ms
 *
 * New signature (score surfaces):
 *   useAnimatedNumber(target, { revealKey: 'deck-id:sig:hero' })
 *   — first render where key is non-null AND not yet consumed tweens 0→target
 *     over revealMs; works even when key/target arrive on a later render (pending→ready).
 *   — subsequent changes use 200ms re-target + snap >5 + popKey.
 */
export function useAnimatedNumber(
  target: number,
  opts?: AnimatedNumberOpts | number
): { display: number; popKey: number } {
  const legacyMode = typeof opts === 'number' || opts === undefined;
  const durationMs = legacyMode
    ? typeof opts === 'number'
      ? opts
      : 200
    : ((opts as AnimatedNumberOpts)?.durationMs ?? 200);
  const revealMs = legacyMode ? 200 : ((opts as AnimatedNumberOpts)?.revealMs ?? 600);
  const revealKey = legacyMode ? undefined : (opts as AnimatedNumberOpts)?.revealKey;

  const reducedMotion = isReducedMotion();

  // Track whether this hook instance has fired its reveal.
  const revealFiredRef = useRef<boolean>(false);
  // Track the key we last armed against, to detect key changes.
  const armedKeyRef = useRef<string | null>(null);

  // Determine if a reveal should fire on the FIRST mount:
  //   - Must have a non-null key (revealFiredRef is always false at construction time)
  //   - Key must not be consumed
  //   - Target must be non-zero (nothing to reveal to)
  // Note: revealFiredRef.current is NOT read here (that would be a ref read during render).
  // It starts false by construction and is only updated from effects.
  const willRevealOnMount =
    !legacyMode &&
    typeof revealKey === 'string' &&
    revealKey !== null &&
    !consumedRevealKeys.has(revealKey) &&
    target !== 0;

  // Initial display value: 0 if we will reveal, else target.
  const [display, setDisplay] = useState<number>(() => (willRevealOnMount ? 0 : target));
  const [popKey, setPopKey] = useState<number>(0);
  const displayRef = useRef<number>(willRevealOnMount ? 0 : target);
  const rafRef = useRef<number | null>(null);
  const tweenRef = useRef<{ from: number; to: number; t0: number } | null>(null);
  const lastTargetRef = useRef<number>(willRevealOnMount ? -Infinity : target);
  const revealDoneRef = useRef<boolean>(!willRevealOnMount);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  // ── Reveal effect: fires whenever canReveal becomes true ─────────────────
  // Uses revealKey as a dep — if key changes AND new key is unconsumed, re-arms.
  useEffect(() => {
    if (legacyMode) return;
    if (typeof revealKey !== 'string' || revealKey === null) return;
    if (consumedRevealKeys.has(revealKey)) return;
    if (revealFiredRef.current) return;
    if (target === 0) return;

    // Arm the reveal.
    revealFiredRef.current = true;
    armedKeyRef.current = revealKey;

    // Mark consumed immediately — prevents a second instance from double-firing.
    if (reducedMotion) {
      consumedRevealKeys.add(revealKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(target);
      displayRef.current = target;
      lastTargetRef.current = target;
      revealDoneRef.current = true;
      return;
    }

    consumedRevealKeys.add(revealKey);

    // Seed lastTargetRef so the re-target effect ignores this value.
    lastTargetRef.current = target;
    revealDoneRef.current = false;

    // Keep a ref to the current target so mid-reveal target changes land correctly.
    const currentTargetRef = { value: target };
    // We'll update this ref from the effect body below; but for simplicity we
    // just capture target at reveal start and rely on re-target logic post-reveal.

    tweenRef.current = { from: 0, to: currentTargetRef.value, t0: performance.now() };

    const tick = (now: number) => {
      const s = tweenRef.current;
      if (!s) {
        rafRef.current = null;
        return;
      }
      const elapsed = now - s.t0;
      const progress = Math.min(1, elapsed / revealMs);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const value = Math.round(s.from + (s.to - s.from) * eased);
      setDisplay(value);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        tweenRef.current = null;
        revealDoneRef.current = true;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey, target !== 0]);
  // Note: target !== 0 as dep — when target first becomes non-zero (pending→ready),
  // this effect re-runs and can arm the reveal.

  // ── Re-target effect (change handling) ──────────────────────────────────
  useEffect(() => {
    if (target === lastTargetRef.current) return;
    lastTargetRef.current = target;

    // While the reveal is still running, update the tween target so mid-reveal
    // changes land on the latest value.
    if (!revealDoneRef.current) {
      if (tweenRef.current) {
        tweenRef.current = { from: tweenRef.current.from, to: target, t0: tweenRef.current.t0 };
      }
      return;
    }

    setPopKey((k) => k + 1);

    if (reducedMotion) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      tweenRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(target);
      return;
    }

    const current = displayRef.current;
    if (Math.abs(target - current) > 5) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
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
  }, [target, durationMs, reducedMotion]);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  return { display, popKey };
}
