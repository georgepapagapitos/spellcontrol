import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { computePeekPlacement, peekWidth } from '@/lib/hover-peek-placement';

// MTG card aspect ratio (Scryfall normal is 488×680) — derives the peek height
// from its (viewport-responsive) width for the vertical centering/clamping math.
const CARD_ASPECT = 680 / 488;
// Below this viewport width there's no gutter to host the peek beside the row,
// so it would just overlap the list. Fall back to click→sheet there. (The
// `(hover: hover) and (pointer: fine)` capability gate already excludes touch;
// this additionally excludes narrow desktop windows + tablet-with-mouse <1024.)
const PEEK_MIN_VIEWPORT = 1024;

export interface HoverPeekState {
  name: string;
  left: number;
  top: number;
  /** Viewport-responsive px width; the component sets it inline so the CSS box
   *  matches the size the placement math used. */
  width: number;
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

  // Any scroll or resize while a peek is up staleness-invalidates its anchor
  // (the row moved) or its size (responsive width), so dismiss it; a re-hover
  // re-pins. Capture-phase to catch scrolls on inner scroll containers too.
  useEffect(() => {
    if (!peek) return;
    const dismiss = () => setPeek(null);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [peek]);

  const onMouseOver = useCallback((e: MouseEvent) => {
    if (!capableRef.current) return;
    const vw = window.innerWidth;
    if (vw < PEEK_MIN_VIEWPORT) return; // no desktop gutter to host the peek
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-peek-name]');
    // Hovering a gap between rows: keep the current peek rather than flicker it.
    if (!el) return;
    const name = el.dataset.peekName;
    if (!name || name === peekRef.current?.name) return;
    const rect = el.getBoundingClientRect();
    const width = peekWidth(vw);
    const height = Math.round(width * CARD_ASPECT);
    const { left, top } = computePeekPlacement(
      rect,
      { width: vw, height: window.innerHeight },
      width,
      height
    );
    setPeek({ name, left, top, width });
  }, []);

  const onMouseLeave = useCallback(() => setPeek(null), []);

  return { peek, clear, listHandlers: { onMouseOver, onMouseLeave } };
}
