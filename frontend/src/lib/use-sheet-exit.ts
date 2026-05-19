import { useCallback, useRef, useState } from 'react';

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
 * `sheet-fall`, and the real `onClose` fires when it finishes.
 *
 * The `sheet-fall` keyframe animates transform, which sits in the CSS
 * Animation cascade origin — above inline style — so it cleanly overrides
 * the swipe gesture's inline `translateY(dragY)` during the exit (the hook
 * resets dragY to 0 before calling onDismiss anyway, so the slide starts
 * from rest in every path).
 */
export function useSheetExit(onClose: () => void) {
  const [isClosing, setIsClosing] = useState(false);
  // Ref guard so a double-trigger (e.g. Escape + backdrop in the same
  // frame) can't start two exits / fire onClose twice before the state
  // re-render lands.
  const closingRef = useRef(false);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const beginClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Reduced motion: there is no slide-down to wait on (the keyframe is
    // neutralized in CSS), so the animationend below would never fire —
    // close immediately instead of leaving the sheet stuck.
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setIsClosing(true);
  }, [onClose]);

  const onAnimationEnd = useCallback(
    (e: React.AnimationEvent) => {
      // Ignore the on-mount `sheet-rise` (and any descendant animation
      // that bubbles up) — only the exit slide should unmount.
      if (closingRef.current && e.animationName === 'sheet-fall') onClose();
    },
    [onClose]
  );

  return { isClosing, beginClose, onAnimationEnd };
}
