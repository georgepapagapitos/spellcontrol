import { useEffect, useState } from 'react';

export interface VisualViewportState {
  /**
   * Pixels the on-screen keyboard (or any interactive widget) occupies at the
   * bottom of the layout viewport. 0 when no keyboard is shown.
   *
   * The default `interactive-widget=resizes-visual` keyboard shrinks only the
   * *visual* viewport and floats over the layout viewport — so a
   * `position: fixed; bottom: 0` element renders *behind* it. Docking such an
   * element at `bottom: <keyboardInset>` lifts it to rest just above the
   * keyboard. This is the cross-browser fix (incl. iOS Safari, which has no
   * `interactive-widget` support).
   */
  keyboardInset: number;
  /** Currently visible viewport height in px (excludes the keyboard). */
  viewportHeight: number;
}

/**
 * Tracks the `VisualViewport` so UI can stay clear of the on-screen keyboard.
 * Returns inert values (0 inset, full innerHeight) when the API is missing.
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => ({
    keyboardInset: 0,
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // The visual viewport spans [offsetTop, offsetTop + height] of the
      // layout viewport; whatever remains at the bottom is the keyboard.
      const keyboardInset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setState({ keyboardInset, viewportHeight: Math.round(vv.height) });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return state;
}
