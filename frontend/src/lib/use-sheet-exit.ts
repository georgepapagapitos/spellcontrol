import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { isNativePlatform } from './platform';
import { useOverlayLayer } from './overlay-layer';
import { useFocusTrap } from './use-focus-trap';

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
  exitAnimationName: string | string[] = 'sheet-fall',
  panelRef?: RefObject<HTMLElement | null>
) {
  const [isClosing, setIsClosing] = useState(false);
  const [exitFrom, setExitFrom] = useState(0);
  const { isTopmost } = useOverlayLayer();
  // Ref guard so a double-trigger (e.g. Escape + backdrop in the same
  // frame) can't start two exits / fire onClose twice before the state
  // re-render lands.
  const closingRef = useRef(false);
  // Latest callback / exit names in refs so `beginClose` and `onAnimationEnd`
  // keep one identity for the sheet's lifetime. Consumers pass inline arrows
  // and array literals; when those flowed into the deps, the Escape and
  // back-button listeners built on them re-subscribed every render, and a
  // listener swapped out mid-dispatch never fires (see use-escape-key.ts).
  const onCloseRef = useRef(onClose);
  const exitNamesRef = useRef(exitAnimationName);
  useEffect(() => {
    onCloseRef.current = onClose;
    exitNamesRef.current = exitAnimationName;
  }, [onClose, exitAnimationName]);
  // Some layouts neutralize the exit keyframe entirely via CSS instead of
  // playing a symmetric fall (e.g. `.card-picker-sheet`'s desktop centered
  // modal sets `animation: none` on `.is-closing` — see
  // binder-card-management.css) — there, `animationend` never fires and the
  // sheet would stay open forever with no way to dismiss it. This fallback
  // timer force-closes after the slowest real exit animation in the app
  // (sheet-fall, 340ms) would have finished; onAnimationEnd clears it below
  // so the normal animated path never double-fires onClose.
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const beginClose = useCallback((fromY = 0) => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Reduced motion: there is no slide-down to wait on (the keyframe is
    // neutralized in CSS), so the animationend below would never fire —
    // close immediately instead of leaving the sheet stuck.
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    // Swipe-dismiss passes a px offset; non-drag paths pass nothing, and a
    // bare onClick={beginClose} would pass a synthetic event — coerce to a
    // finite number so the CSS var never goes garbage.
    setExitFrom(typeof fromY === 'number' && Number.isFinite(fromY) ? fromY : 0);
    setIsClosing(true);
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      onCloseRef.current();
    }, 600);
  }, []);

  const onAnimationEnd = useCallback((e: React.AnimationEvent) => {
    // Ignore the on-mount entry animation (and any descendant animation
    // that bubbles up) — only the exit animation should unmount.
    const names = exitNamesRef.current;
    const exitNames = Array.isArray(names) ? names : [names];
    if (closingRef.current && exitNames.includes(e.animationName)) {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      onCloseRef.current();
    }
  }, []);

  // Unmounting mid-close for an unrelated reason (route change, parent
  // stopped rendering this sheet) — drop the pending fallback so it can't
  // fire `onClose` against whatever now owns that callback.
  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  // Android hardware back button. Without a listener Capacitor's default is to
  // navigate the WebView's own history, which left the sheet visually stuck
  // open while the page underneath changed. `<Modal>` has answered back since
  // T11; sheets never did, so this was broken on ~30 surfaces. Same shared
  // layer stack as Modal, so a confirm dialog opened on top of a sheet is the
  // one that answers — with two stacks both would close on one press.
  useEffect(() => {
    if (!isNativePlatform()) return;
    const handle = CapacitorApp.addListener('backButton', () => {
      if (!isTopmost()) return;
      beginClose();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [beginClose, isTopmost]);

  // Focus containment — wired here, not per sheet, so all ~40 useSheetExit
  // consumers get it for free instead of each threading a panel ref through
  // (see use-focus-trap.ts for how it finds "its" panel without one, and how
  // stacking with a confirm Modal is arbitrated). Without it a sheet opened
  // while focus sat on the page behind it left Tab walking through the
  // content underneath, and any `onKeyDown` the sheet declared on its own
  // subtree never fired at all (nothing inside it had focus) — which is why
  // BuildReportSheet's Escape handler did nothing.
  useFocusTrap(isTopmost, panelRef);

  // Spread onto the sheet element. While closing, pins sheet-fall's `from`
  // keyframe to the release offset so the exit continues from where the
  // finger let go; idle (not closing) it contributes nothing.
  const exitStyle: CSSProperties | undefined = isClosing
    ? ({ ['--sheet-exit-from' as string]: `${exitFrom}px` } as CSSProperties)
    : undefined;

  return { isClosing, beginClose, onAnimationEnd, exitStyle };
}
