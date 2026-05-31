import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { computePeekPlacement } from '@/lib/hover-peek-placement';

// px width of the floating peek — MUST match `.deck-card-hover-peek` width in
// DeckHoverPeek.css. The placement math needs a concrete size and the CSS needs
// a concrete box; this constant is the shared source of truth, with the height
// derived to the MTG card proportion below.
const PEEK_WIDTH = 240;
// MTG card aspect ratio (Scryfall normal is 488×680). Drives vertical
// centering/clamping in the placement math.
const PEEK_HEIGHT = Math.round((PEEK_WIDTH * 680) / 488);

export interface HoverPeekState {
  name: string;
  left: number;
  top: number;
}

/**
 * Desktop-only hover-peek for the deck list: hovering a row floats the full card
 * art into the empty horizontal gutter beside it (the 20q2 `FloatingPreview`
 * pattern) so a card can be inspected without leaving the list or opening the
 * full-screen sheet. Capability-gated to `(hover: hover) and (pointer: fine)`,
 * so touch / mobile / native never trigger it — those keep the tap→sheet flow
 * unchanged. Returns the active peek plus delegated handlers to spread on the
 * list container (one `data-peek-name` attribute per row is all the markup it
 * needs).
 */
export function useDeckHoverPeek() {
  const [peek, setPeek] = useState<HoverPeekState | null>(null);
  // Mirror in a ref (synced via effect, never written during render) so the
  // stable handlers can dedupe against the current peek without re-subscribing.
  const peekRef = useRef<HoverPeekState | null>(null);
  useEffect(() => {
    peekRef.current = peek;
  }, [peek]);
  const capableRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => {
      capableRef.current = mql.matches;
      if (!mql.matches) setPeek(null); // a fine pointer was unplugged mid-hover
    };
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  const clear = useCallback(() => setPeek(null), []);

  // Any scroll while a peek is up staleness-invalidates its anchor (the row
  // moved), so dismiss it; a re-hover re-pins. Capture-phase to catch scrolls
  // on inner scroll containers too.
  useEffect(() => {
    if (!peek) return;
    const onScroll = () => setPeek(null);
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [peek]);

  const onMouseOver = useCallback((e: MouseEvent) => {
    if (!capableRef.current) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-peek-name]');
    // Hovering a gap between rows: keep the current peek rather than flicker it.
    if (!el) return;
    const name = el.dataset.peekName;
    if (!name || name === peekRef.current?.name) return;
    const rect = el.getBoundingClientRect();
    const { left, top } = computePeekPlacement(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      PEEK_WIDTH,
      PEEK_HEIGHT
    );
    setPeek({ name, left, top });
  }, []);

  const onMouseLeave = useCallback(() => setPeek(null), []);

  return { peek, clear, listHandlers: { onMouseOver, onMouseLeave } };
}
