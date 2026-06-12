import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { captureBaseline, mapOrientationToTilt, type OrientationSample } from './tilt-mapping';

/**
 * Drives a holographic foil effect by tracking the cursor over a target element
 * and writing CSS custom properties (--rx, --ry, --mx, --my, --hyp) directly to
 * the DOM. CSS picks these up to animate tilt, glare position, and shimmer.
 *
 * On touch/native devices, a device-orientation source is available via
 * `enableGyro`. When active it feeds the same lerp pipeline so tilting the
 * phone moves the foil glare — the physical-binder fantasy in the hand.
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

  /**
   * Enable device-orientation (gyro) tilt. Only takes effect on touch/native
   * devices (`hover: none`) and when `prefers-reduced-motion` is not set.
   *
   * Pass a stable baseline-capture callback that will be called with the first
   * orientation sample when the listener attaches, so the delta-mapping starts
   * from the phone's current angle rather than absolute zero.
   *
   * The listener attaches when both this flag is true AND `enabled` is true;
   * it detaches on cleanup (zero idle cost when the preview is closed).
   */
  enableGyro?: boolean;
}

export function useHolographic(enabled: boolean, options: HolographicOptions = {}) {
  // Stash in a ref so the effect doesn't have to re-bind listeners every render
  // when the caller passes a fresh function.
  const suppressRef = useRef(options.shouldSuppressTilt);
  const enableGyroRef = useRef(options.enableGyro);
  useLayoutEffect(() => {
    suppressRef.current = options.shouldSuppressTilt;
    enableGyroRef.current = options.enableGyro;
  });

  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useEffect(() => {
    if (!el || !enabled) return;

    let rafId: number | null = null;
    // Targets are what mousemove writes; current is what we lerp toward them.
    // gx/gy are normalized cursor offset in [-1, 1] — used by CSS for tilt-aware
    // shadow direction and inner-bevel highlight, where percentages can't be
    // multiplied into px values directly.
    // act is 0..1 — 1 while the cursor is on the card, lerps to 0 on leave.
    // CSS reads it as --active and uses it to gate the foil overlay opacity
    // so foil only appears during interaction (matches simey/pokemon-cards
    // approach of opacity = card-opacity).
    const target = { rx: 0, ry: 0, mx: 50, my: 50, hyp: 0, gx: 0, gy: 0, act: 0 };
    const current = { rx: 0, ry: 0, mx: 50, my: 50, hyp: 0, gx: 0, gy: 0, act: 0 };
    let active = false;

    const apply = () => {
      // Lerp current → target. Higher factor = snappier. While the cursor is
      // active we want it tracking tightly; on leave we ease back gently.
      const k = active ? 0.28 : 0.1;
      current.rx += (target.rx - current.rx) * k;
      current.ry += (target.ry - current.ry) * k;
      current.mx += (target.mx - current.mx) * k;
      current.my += (target.my - current.my) * k;
      current.hyp += (target.hyp - current.hyp) * k;
      current.gx += (target.gx - current.gx) * k;
      current.gy += (target.gy - current.gy) * k;
      current.act += (target.act - current.act) * k;

      el.style.setProperty('--rx', `${current.rx.toFixed(2)}deg`);
      el.style.setProperty('--ry', `${current.ry.toFixed(2)}deg`);
      el.style.setProperty('--mx', `${current.mx.toFixed(2)}%`);
      el.style.setProperty('--my', `${current.my.toFixed(2)}%`);
      el.style.setProperty('--hyp', current.hyp.toFixed(3));
      el.style.setProperty('--gx', current.gx.toFixed(3));
      el.style.setProperty('--gy', current.gy.toFixed(3));
      el.style.setProperty('--active', current.act.toFixed(3));

      // Stop the loop when we've settled close to neutral.
      const settled =
        Math.abs(current.rx - target.rx) < 0.05 &&
        Math.abs(current.ry - target.ry) < 0.05 &&
        Math.abs(current.mx - target.mx) < 0.1 &&
        Math.abs(current.my - target.my) < 0.1;
      if (settled && !active) {
        rafId = null;
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
      // Hypotenuse: 0 at center, 1 at corner — used to crank up shimmer near edges.
      const dx = cx - 0.5;
      const dy = cy - 0.5;
      target.hyp = Math.min(1, Math.hypot(dx, dy) * 2);
      // Normalized -1..1 offsets for shadow/bevel direction in CSS.
      target.gx = (cx - 0.5) * 2;
      target.gy = (cy - 0.5) * 2;
      target.act = 1;
      active = true;
      ensureLoop();
    };

    const reset = () => {
      target.rx = 0;
      target.ry = 0;
      target.mx = 50;
      target.my = 50;
      target.hyp = 0;
      target.gx = 0;
      target.gy = 0;
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

    // ── Gyro orientation tilt (touch/native only) ─────────────────────────
    // Attaches a deviceorientation listener on touch-only, non-pointer devices
    // when enableGyro is requested. Feeds the same lerp pipeline as the cursor
    // path. Hard-disabled under prefers-reduced-motion (vestibular motion from
    // hand movement is exactly what that setting is for).
    //
    // Gates (all must hold):
    //   1. enableGyro option is true
    //   2. Touch device. NOT `(hover: none)` — Samsung WebViews report
    //      `hover: hover` on touch (the documented Galaxy trap), so the robust
    //      check is the inverse of the full desktop gate: anything that isn't
    //      a fine-pointer hover device is touch.
    //   3. prefers-reduced-motion is NOT set
    //   4. DeviceOrientationEvent is available
    let removeGyro: (() => void) | null = null;

    const touchOnly =
      typeof window !== 'undefined' &&
      !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (
      enableGyroRef.current &&
      touchOnly &&
      !reducedMotion &&
      typeof window !== 'undefined' &&
      'DeviceOrientationEvent' in window
    ) {
      let baseline: OrientationSample | null = null;

      const onOrientation = (e: DeviceOrientationEvent) => {
        const sample: OrientationSample = { beta: e.beta, gamma: e.gamma };

        // Capture the first reading as the neutral baseline so the delta
        // is zero when the phone is held at the angle it was at preview-open.
        if (!baseline) {
          baseline = captureBaseline(sample);
          return;
        }

        const suppressed = suppressRef.current?.() === true;
        if (suppressed) {
          // During a swipe: ease everything back to neutral.
          target.rx = 0;
          target.ry = 0;
          target.mx = 50;
          target.my = 50;
          target.act = 0;
          active = false;
          ensureLoop();
          return;
        }

        const tilt = mapOrientationToTilt(sample, baseline);
        target.rx = tilt.rx;
        target.ry = tilt.ry;
        target.mx = tilt.mx;
        target.my = tilt.my;
        // hyp: use the Euclidean distance of rx/ry relative to max range.
        const dx = tilt.ry / 7; // normalized -1..1
        const dy = tilt.rx / 7;
        target.hyp = Math.min(1, Math.hypot(dx, dy));
        target.gx = dx;
        target.gy = dy;
        target.act = 1;
        active = true;
        ensureLoop();
      };

      window.addEventListener('deviceorientation', onOrientation);

      removeGyro = () => {
        window.removeEventListener('deviceorientation', onOrientation);
      };
    }

    return () => {
      if (hasPointer) {
        el.removeEventListener('mousemove', onMouseMove);
        el.removeEventListener('mouseleave', reset);
      }
      removeGyro?.();
      if (rafId != null) cancelAnimationFrame(rafId);
      // Clear vars so the slide returns to flat instantly on prop change.
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
      el.style.removeProperty('--mx');
      el.style.removeProperty('--my');
      el.style.removeProperty('--hyp');
      el.style.removeProperty('--gx');
      el.style.removeProperty('--gy');
      el.style.removeProperty('--active');
    };
  }, [el, enabled]);

  return ref;
}
