import { useEffect } from 'react';

/**
 * Lock body scroll while `active` is true so swipe / overscroll gestures
 * can't bleed through to the page behind a modal or full-screen sheet.
 */
export function useLockBodyScroll(active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'contain';
    return () => {
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
    };
  }, [active]);
}
