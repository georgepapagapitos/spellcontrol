import { useEffect, useState } from 'react';

/**
 * The local life-counter board asks a phone lying flat on the table to keep
 * its seats facing the same physical edges regardless of which way the
 * device itself is rotated — a phone that auto-rotates into landscape must
 * not spin the board. This is the opposite ruling from the playtest table's
 * `RotatePrompt`, which WANTS the phone turned sideways to see more of the
 * battlefield and never locks orientation for that reason (see
 * STYLE_GUIDE "Play board: landscape keeps the board still" for why the two
 * differ). Must stay textually identical to the CSS media query in
 * `play-board.css`'s `.game-board-rotator` rules, or the JS rotation angle
 * and the CSS transform it drives would activate at different breakpoints.
 */
export const KEEP_STILL_QUERY =
  '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';

/**
 * 0 = no counter-rotation (portrait, or a landscape tablet/wide window tall
 * enough that the board just reflows normally). 90 / -90 = the board's whole
 * rendered tree is counter-rotated that many degrees so every seat keeps
 * facing the physical edge it faced before the device rotated.
 *
 * Sign: `screen.orientation.type` reports which way the device physically
 * turned (`landscape-primary` vs `landscape-secondary`); the counter-
 * rotation is the opposite sign the browser's own auto-rotate applied, so
 * painting cancels it out. Unsupported browsers (iOS Safari has no
 * `screen.orientation`, only the deprecated `window.orientation`) fall back
 * to `window.orientation` where present, else the landscape-primary case
 * (-90) — a reasonable default since it's what most phones use turned
 * clockwise, the common grip.
 *
 * ponytail: the primary/secondary → ∓90 mapping is verified against headless
 * Edge's `Emulation.setDeviceMetricsOverride({ screenOrientation })` (a
 * clean, unmirrored 90° rotation either way, opposite handedness for
 * primary vs secondary — see the lane's report for the exact geometry), not
 * against a real phone — there's no hardware in this environment to confirm
 * which sign a real Android/iOS auto-rotate expects cancelled. If a real
 * device shows seats spinning 90° the wrong way, flip the two `return`
 * values in the `type ===` branches above; everything downstream (the CSS
 * transform, the gesture composition) only cares that primary/secondary are
 * opposite signs, not which specific sign either one is.
 */
export function useBoardKeepStill(): 0 | 90 | -90 {
  const [rotation, setRotation] = useState<0 | 90 | -90>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mql = window.matchMedia(KEEP_STILL_QUERY);

    const compute = (): 0 | 90 | -90 => {
      if (!mql.matches) return 0;
      const type = window.screen.orientation?.type;
      if (type === 'landscape-secondary') return 90;
      if (type === 'landscape-primary') return -90;
      // No Screen Orientation API (iOS Safari): window.orientation is the
      // deprecated but still-supported fallback there. 90/-90 both mean
      // landscape; -90 (legacy) === landscape-primary in modern terms.
      const legacy = (window as unknown as { orientation?: number }).orientation;
      if (legacy === 90) return 90;
      return -90;
    };

    const update = () => setRotation(compute());
    update();
    mql.addEventListener('change', update);
    window.screen.orientation?.addEventListener?.('change', update);
    window.addEventListener('orientationchange', update);
    return () => {
      mql.removeEventListener('change', update);
      window.screen.orientation?.removeEventListener?.('change', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return rotation;
}
