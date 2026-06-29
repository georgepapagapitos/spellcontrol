import { type CSSProperties, useCallback, useRef, useState } from 'react';

/**
 * Symmetric slide-down dismissal for the full-screen drawer sheets
 * (CardPreview, BinderPagePreview). The open is a `sheet-rise` keyframe;
 * without this the close just unmounts and the sheet vanishes — visibly
 * asymmetric. Shared so both carousels stay in lockstep, mirroring the
 * use-swipe-down-dismiss / use-centered-slide convention.
 *
 * Usage: route every dismiss path (close button, Escape, backdrop tap,
 * tap-to-close, the swipe `onDismiss`) through `beginClose` instead of
 * the raw `onClose`. Spread `onAnimationEnd` on the sheet element and add
 * the `is-closing` class while `isClosing` is true; the CSS plays
 * `sheet-fall`, and the real `onClose` fires when it finishes. Responsive
 * surfaces that swap exit keyframes by media query can pass multiple accepted
 * animation names.
 *
 * The `sheet-fall` keyframe animates transform, which sits in the CSS
 * Animation cascade origin — above inline style — so it cleanly overrides
 * the swipe gesture's inline `translateY(dragY)` during the exit. Its `from`
 * step reads `--sheet-exit-from` (px), so a swipe-dismiss continues sliding
 * down from where the finger let go instead of jerking back to translateY(0)
 * before falling. Spread the returned `exitStyle` onto the sheet element to
 * supply that var; non-drag paths (button / Escape / backdrop) pass nothing
 * and fall from 0 exactly as before.
 *
 * `exitAnimationName` defaults to the bottom-sheet `sheet-fall` keyframe.
 * Surfaces whose entry isn't a bottom rise (the stats side-drawer's X slide,
 * the scanner sheet's fade+nudge, the add-cards modal pop) pass their own
 * symmetric exit keyframe name so `onAnimationEnd` unmounts on the right
 * animation — everything else about the contract is identical.
 */
export function useSheetExit(
  onClose: () => void,
  exitAnimationName: string | string[] = 'sheet-fall'
) {
  const [isClosing, setIsClosing] = useState(false);
  const [exitFrom, setExitFrom] = useState(0);
  // Ref guard so a double-trigger (e.g. Escape + backdrop in the same
  // frame) can't start two exits / fire onClose twice before the state
  // re-render lands.
  const closingRef = useRef(false);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const beginClose = useCallback(
    (fromY = 0) => {
      if (closingRef.current) return;
      closingRef.current = true;
      // Reduced motion: there is no slide-down to wait on (the keyframe is
      // neutralized in CSS), so the animationend below would never fire —
      // close immediately instead of leaving the sheet stuck.
      if (prefersReducedMotion()) {
        onClose();
        return;
      }
      // Swipe-dismiss passes a px offset; non-drag paths pass nothing, and a
      // bare onClick={beginClose} would pass a synthetic event — coerce to a
      // finite number so the CSS var never goes garbage.
      setExitFrom(typeof fromY === 'number' && Number.isFinite(fromY) ? fromY : 0);
      setIsClosing(true);
    },
    [onClose]
  );

  const onAnimationEnd = useCallback(
    (e: React.AnimationEvent) => {
      // Ignore the on-mount entry animation (and any descendant animation
      // that bubbles up) — only the exit animation should unmount.
      const exitNames = Array.isArray(exitAnimationName) ? exitAnimationName : [exitAnimationName];
      if (closingRef.current && exitNames.includes(e.animationName)) onClose();
    },
    [onClose, exitAnimationName]
  );

  // Spread onto the sheet element. While closing, pins sheet-fall's `from`
  // keyframe to the release offset so the exit continues from where the
  // finger let go; idle (not closing) it contributes nothing.
  const exitStyle: CSSProperties | undefined = isClosing
    ? ({ ['--sheet-exit-from' as string]: `${exitFrom}px` } as CSSProperties)
    : undefined;

  return { isClosing, beginClose, onAnimationEnd, exitStyle };
}
