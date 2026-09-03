import { useEffect, useRef } from 'react';

/**
 * Escape → `onEscape`, subscribed once for the hook's lifetime.
 *
 * The latest callback lives in a ref rather than in the effect's deps. Every
 * caller passes an inline arrow, so depending on it re-subscribed on every
 * render — and a listener swapped out mid-dispatch never fires: the browser
 * runs a microtask checkpoint between the listeners of a trusted key event,
 * React flushes any pending state there, and if that render replaced this
 * listener the same Escape skipped it. That is how the deck editor's hint
 * strip (an earlier `useEscapeKey`) ate the Escape meant for the export
 * dialog's Modal.
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscapeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
