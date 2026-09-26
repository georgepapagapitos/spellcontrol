import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Drives the holographic foil by tracking the cursor over a target element and
 * writing CSS custom properties (--rx, --ry, --mx, --my, --active) directly to
 * the DOM. CSS picks these up to tilt the card and slide the foil's spectrum
 * and glare (holographic.css).
 *
 * Uses requestAnimationFrame for smoothing and bypasses React entirely on hover —
 * mousemove fires often enough that going through setState would tank framerate.
 *
 * Returns a callback ref so listeners re-bind whenever the target element changes
 * (e.g. carousel swaps which slide is active).
 */
interface HolographicOptions {
  /** Optional getter that returns true when tilt should be suppressed (e.g. during
   *  a touch swipe gesture handled by a parent). When true, glare/shimmer still
   *  track the cursor but rotateX/rotateY are pinned to 0 so the card doesn't
   *  fight the swipe visually. */
  shouldSuppressTilt?: () => boolean;
}

/** Where the light sits with no cursor on the card: upper-left, like a room
 *  light. holographic.css parks the glare at the same 32% / 22% when these
 *  vars are unset, so leaving the card eases back to the resting picture. */
export const HOLO_REST: Readonly<{ mx: number; my: number }> = { mx: 32, my: 22 };

/** Smoothing time constants (ms): tight while tracking, gentle on release.
 *  Time-based, so a 120Hz display settles exactly as fast as a 60Hz one. */
const TAU_TRACK = 55;
const TAU_RELEASE = 160;

export function useHolographic(enabled: boolean, options: HolographicOptions = {}) {
  // Stash in a ref so the effect doesn't have to re-bind listeners every render
  // when the caller passes a fresh function.
  const suppressRef = useRef(options.shouldSuppressTilt);
  useLayoutEffect(() => {
    suppressRef.current = options.shouldSuppressTilt;
  });

  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useEffect(() => {
    if (!el || !enabled) return;

    let rafId: number | null = null;
    let lastT: number | null = null;
    // Targets are what mousemove writes; current is what we ease toward them.
    // act is 0..1 — 1 while the cursor is on the card, eases to 0 on leave.
    // CSS reads it as --active to lift the foil from its resting level.
    const target = { rx: 0, ry: 0, mx: HOLO_REST.mx, my: HOLO_REST.my, act: 0 };
    const current = { ...target };
    let active = false;

    const apply = (t: number) => {
      // The first frame of a run only starts the clock (assuming a 16ms frame
      // would run 120Hz displays ahead). Clamp dt so a tab resuming from the
      // background doesn't jump in one frame.
      const dt = lastT == null ? 0 : Math.min(64, Math.max(0, t - lastT));
      lastT = t;
      const k = 1 - Math.exp(-dt / (active ? TAU_TRACK : TAU_RELEASE));
      current.rx += (target.rx - current.rx) * k;
      current.ry += (target.ry - current.ry) * k;
      current.mx += (target.mx - current.mx) * k;
      current.my += (target.my - current.my) * k;
      current.act += (target.act - current.act) * k;

      el.style.setProperty('--rx', `${current.rx.toFixed(2)}deg`);
      el.style.setProperty('--ry', `${current.ry.toFixed(2)}deg`);
      el.style.setProperty('--mx', `${current.mx.toFixed(2)}%`);
      el.style.setProperty('--my', `${current.my.toFixed(2)}%`);
      el.style.setProperty('--active', current.act.toFixed(3));

      // Stop once everything has settled — the foil's lift included, or a
      // leave that starts near the rest point would freeze it half-lit.
      const settled =
        Math.abs(current.rx - target.rx) < 0.05 &&
        Math.abs(current.ry - target.ry) < 0.05 &&
        Math.abs(current.mx - target.mx) < 0.1 &&
        Math.abs(current.my - target.my) < 0.1 &&
        Math.abs(current.act - target.act) < 0.005;
      if (settled && !active) {
        rafId = null;
        lastT = null;
        return;
      }
      rafId = requestAnimationFrame(apply);
    };

    const ensureLoop = () => {
      if (rafId == null) rafId = requestAnimationFrame(apply);
    };

    const onMove = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width; // 0..1
      const y = (clientY - rect.top) / rect.height;
      // Clamp to viewport in case of subpixel overshoot.
      const cx = Math.max(0, Math.min(1, x));
      const cy = Math.max(0, Math.min(1, y));
      // Tilt range: ±7° — a subtle parallax that reads as a real tilt without
      // the exaggerated swing of the codepen reference (±18°).
      // Suppressed during parent-owned swipe gestures so the tilt doesn't fight
      // the navigation/dismiss flick.
      const suppressed = suppressRef.current?.() === true;
      target.ry = suppressed ? 0 : (cx - 0.5) * 14;
      target.rx = suppressed ? 0 : (0.5 - cy) * 14;
      target.mx = cx * 100;
      target.my = cy * 100;
      target.act = 1;
      active = true;
      ensureLoop();
    };

    const reset = () => {
      target.rx = 0;
      target.ry = 0;
      target.mx = HOLO_REST.mx;
      target.my = HOLO_REST.my;
      target.act = 0;
      active = false;
      ensureLoop();
    };

    // Only attach tilt on devices with a pointer — continuous mousemove gives
    // a satisfying parallax effect with zero UX cost. On touch-only devices
    // we skip entirely: the old tap-to-peek interaction consumed the tap and
    // prevented the natural "tap to close" behavior users expect.
    const hasPointer = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);

    if (hasPointer) {
      el.addEventListener('mousemove', onMouseMove);
      el.addEventListener('mouseleave', reset);
    }

    return () => {
      if (hasPointer) {
        el.removeEventListener('mousemove', onMouseMove);
        el.removeEventListener('mouseleave', reset);
      }
      if (rafId != null) cancelAnimationFrame(rafId);
      // Clear vars so the slide returns to flat instantly on prop change.
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
      el.style.removeProperty('--mx');
      el.style.removeProperty('--my');
      el.style.removeProperty('--active');
    };
  }, [el, enabled]);

  return ref;
}
