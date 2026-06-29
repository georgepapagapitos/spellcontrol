import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  computePeekPlacement,
  computePointerPlacement,
  peekWidth,
} from '@/lib/hover-peek-placement';

// MTG card aspect ratio (Scryfall normal is 488×680) — derives the peek height
// from its (viewport-responsive) width for the vertical centering/clamping math.
const CARD_ASPECT = 680 / 488;
// Default min viewport for the gutter ('row') anchor: below this there's no
// gutter to host the peek beside a row, so it would overlap the list. The
// default cursor ('pointer') anchor needs no gutter, so it activates at any width.

export interface HoverPeekOptions {
  /** Smallest viewport width (px) at which the peek activates. Default 0 — the
   *  cursor anchor needs no gutter. Pass a floor (e.g. 1024) only for the legacy
   *  gutter anchor, which needs the room. */
  minViewport?: number;
  /** 'pointer' (default) floats the peek beside the cursor — works in a centered
   *  panel or a list, at any width, and is the unified behavior across surfaces.
   *  'row' pins it in the gutter beside the hovered row (needs `minViewport`). */
  anchor?: 'row' | 'pointer';
}

export interface HoverPeekState {
  name: string;
  /** Explicit image for THIS hovered element (a `data-peek-img`). Lets a
   *  specific printing's art be peeked even though it shares the row's name;
   *  when absent the consumer resolves art by name. Also the dedupe key, so two
   *  same-named printings don't collapse into one peek. */
  img?: string;
  left: number;
  top: number;
  /** Viewport-responsive px width; the component sets it inline so the CSS box
   *  matches the size the placement math used. */
  width: number;
}

/**
 * Hover-peek shared by the deck list and the Tune Improve lane: hovering a
 * `[data-peek-name]` element floats the full card art beside the cursor so a card
 * can be inspected without leaving the surface or opening the full-screen sheet.
 * Cursor-anchored by default (works in a list or a centered panel, at any
 * viewport width); a legacy `anchor: 'row'` gutter mode remains for callers that
 * have the room. Capability-gated to `(hover: hover) and (pointer: fine)`, so
 * touch / mobile / native never trigger it — those keep the tap→sheet flow.
 * Dismisses the moment the pointer leaves a tracked element (or the container).
 * Returns the active peek plus delegated handlers to spread on the container
 * (one `data-peek-name` attribute per hoverable element is all the markup it needs).
 */
export function useDeckHoverPeek({ minViewport = 0, anchor = 'pointer' }: HoverPeekOptions = {}) {
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

  const onMouseOver = useCallback(
    (e: MouseEvent) => {
      if (!capableRef.current) return;
      const vw = window.innerWidth;
      if (vw < minViewport) return; // gutter anchor needs the room; pointer passes 0
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-peek-name]');
      if (!el) {
        // Pointer anchor follows the thumbnail, so leaving it (onto the row body
        // or a gap) hides the peek. Row anchor keeps it to avoid row-to-row flicker.
        if (anchor === 'pointer') setPeek(null);
        return;
      }
      const name = el.dataset.peekName;
      if (!name) return;
      // An explicit per-element image (a printing sub-row) is also the dedupe
      // key, so moving between same-named printings still re-pins the peek.
      const img = el.dataset.peekImg;
      const prevKey = peekRef.current ? (peekRef.current.img ?? peekRef.current.name) : undefined;
      if ((img ?? name) === prevKey) return;
      const width = peekWidth(vw);
      const height = Math.round(width * CARD_ASPECT);
      const viewport = { width: vw, height: window.innerHeight };
      const { left, top } =
        anchor === 'pointer'
          ? computePointerPlacement(e.clientX, e.clientY, viewport, width, height)
          : computePeekPlacement(el.getBoundingClientRect(), viewport, width, height);
      setPeek({ name, img, left, top, width });
    },
    [minViewport, anchor]
  );

  const onMouseOut = useCallback((e: MouseEvent) => {
    if (!peekRef.current) return;
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-peek-name]');
    if (!from) return;
    const related = e.relatedTarget;
    const to = related instanceof Element ? related.closest<HTMLElement>('[data-peek-name]') : null;
    if (!to) setPeek(null);
  }, []);

  const onMouseLeave = useCallback(() => setPeek(null), []);

  return { peek, clear, listHandlers: { onMouseOver, onMouseOut, onMouseLeave } };
}
