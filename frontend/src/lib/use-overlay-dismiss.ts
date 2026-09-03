import { useEffect, type RefObject } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { isNativePlatform } from './platform';
import { useOverlayLayer } from './overlay-layer';
import { useFocusTrap } from './use-focus-trap';

/**
 * The dismiss half of the overlay contract for surfaces that are neither a
 * `<Modal>` nor a `useSheetExit` sheet: the game board's in-panel covers
 * (seat menu, counters, life keypad), its bottom-sheet game menu and the
 * custom layout editor. Those render in place — the seat menu inherits its
 * panel's rotation, the game menu rises from the board's own edge — so
 * they can't portal through `<Modal>`, and until this hook existed they
 * answered neither Escape nor the Android hardware back button and let Tab
 * walk out onto the board behind them.
 *
 * Same shared layer stack as Modal and useSheetExit, so only the topmost
 * overlay answers one Escape / one back press (a confirm dialog opened on
 * top of the game menu closes first), and the same Tab trap + focus
 * restoration via `useFocusTrap`. No exit animation: these surfaces close
 * on the next render, exactly as their close buttons already did.
 *
 * `panelRef` should point at the `[role="dialog"]` element so the trap
 * targets it exactly rather than querying the last dialog in the document.
 */
export function useOverlayDismiss(
  onClose: () => void,
  panelRef?: RefObject<HTMLElement | null>
): void {
  const { isTopmost } = useOverlayLayer();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopmost()) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, isTopmost]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    const handle = CapacitorApp.addListener('backButton', () => {
      if (!isTopmost()) return;
      onClose();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [onClose, isTopmost]);

  useFocusTrap(isTopmost, panelRef);
}
