import { type CSSProperties, useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Delayed-unmount + FLIP-glide + entry driver for a top-anchored <ul> list.
 *
 * Modeled on `use-toast-exits.ts` (same techniques: derive-departures-during-
 * render, delayed-unmount ghosts, `applyRestackGlide` invert-and-release, a
 * `useLayoutEffect` measure/FLIP pass, reduced-motion early-outs). Key
 * differences from the toast hook:
 *
 * - TOP-anchored: positions are measured relative to the container's TOP edge
 *   (not the bottom), since this list grows downward.
 * - Entry: a key new since last commit gets `entering: true` so a CSS enter
 *   keyframe plays once. Initial keys are seeded into `prevKeys` so the first
 *   mount does NOT animate every row.
 * - Exit: departed keys keep rendering as leaving ghosts (position:absolute,
 *   top offset from container top) until their leave animation ends.
 */

export interface ListFlipEntry<T> {
  key: string;
  item: T;
  /** True on the commit the key first appears (post-mount); drives enter keyframe. */
  entering: boolean;
  /** False for live rows. */
  leaving: false;
}

export interface ListFlipGhost<T> {
  key: string;
  item: T;
  entering: false;
  /** True — this is an absolutely-pinned ghost playing its leave animation. */
  leaving: true;
  /** Inline style that pins the ghost at its last in-flow position. */
  style: CSSProperties;
}

export type ListFlipRow<T> = ListFlipEntry<T> | ListFlipGhost<T>;

// ── Pure helpers (exported for unit-test coverage) ──────────────────────────

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/**
 * Keys present in `prev` but absent from `next` → departing keys.
 * Returns an empty array when nothing changed (referential check + size guard).
 */
export function computeListDepartures(prev: string[], next: string[]): string[] {
  if (prev === next || prev.length === 0) return [];
  const liveSet = new Set(next);
  return prev.filter((k) => !liveSet.has(k));
}

/**
 * Keys present in `next` but absent from `prev` → entering keys.
 * Returns an empty array when nothing changed (referential check + size guard).
 */
export function computeListEntries(prev: string[], next: string[]): string[] {
  if (prev === next || next.length === 0) return [];
  const prevSet = new Set(prev);
  return next.filter((k) => !prevSet.has(k));
}

/**
 * FLIP release: start the element at its inverted (old) position with the
 * transition suppressed, force a style flush, then clear both — the CSS
 * `transition: transform` on the row takes over and glides to the new slot.
 * (Verbatim copy from use-toast-exits.ts.)
 */
export function applyRestackGlide(el: HTMLElement, deltaY: number): void {
  if (deltaY === 0) return;
  el.style.transition = 'none';
  el.style.transform = `translateY(${deltaY}px)`;
  // Forced reflow — without it the two writes coalesce and nothing glides.
  void el.offsetHeight;
  el.style.transition = '';
  el.style.transform = '';
}

interface ExitingRow<T> {
  key: string;
  item: T;
  /** px from the container's top edge down to the row's top edge; null when never measured. */
  topOffset: number | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useListFlip<T>(
  items: T[],
  getKey: (item: T) => string,
  containerRef: React.RefObject<HTMLElement | null>
): {
  entries: ListFlipRow<T>[];
  /** Callback ref for each row's root DOM element, keyed by item key. */
  registerItem: (key: string, el: HTMLElement | null) => void;
  /** Call on a ghost's `animationend` to drop it. */
  onExitEnd: (key: string) => void;
} {
  const [exiting, setExiting] = useState<ExitingRow<T>[]>([]);
  const domItemsRef = useRef(new Map<string, HTMLElement>());
  // Top-relative offsets written by the layout pass; read during render to pin ghosts.
  const topOffsetsRef = useRef(new Map<string, number>());

  // ── Derive departures/entries during render ─────────────────────────────
  // Seed prevItems with the initial list so the first paint does NOT animate
  // every row (mirrors how use-toast-exits.ts seeds prevToasts).
  const currentKeys = items.map(getKey);
  // Store the full previous items array (not just keys) so we can recover item
  // objects for ghosts without reading a ref during render.
  const [prevItems, setPrevItems] = useState<T[]>(items);
  const [enteringKeys, setEnteringKeys] = useState<Set<string>>(new Set());

  if (prevItems !== items) {
    setPrevItems(items);

    const reduce = prefersReducedMotion();
    const prevKeys = prevItems.map(getKey);

    // Departures → ghost
    const departed = computeListDepartures(prevKeys, currentKeys);
    if (departed.length > 0 && !reduce) {
      // Build a key→item map from the PREVIOUS items (captured in this render closure).
      const prevByKey = new Map(prevItems.map((it) => [getKey(it), it]));
      setExiting((cur) => {
        const have = new Set(cur.map((e) => e.key));
        const additions = departed
          .filter((k) => !have.has(k))
          .map((k) => ({
            key: k,
            item: prevByKey.get(k) as T,
            topOffset: topOffsetsRef.current.get(k) ?? null,
          }));
        return additions.length > 0 ? [...cur, ...additions] : cur;
      });
    }

    // Entries → entering set (only post-mount new keys)
    const entered = computeListEntries(prevKeys, currentKeys);
    if (entered.length > 0 && !reduce) {
      setEnteringKeys(new Set(entered));
    } else {
      setEnteringKeys(new Set());
    }
  }

  const registerItem = useCallback((key: string, el: HTMLElement | null) => {
    if (el) domItemsRef.current.set(key, el);
    else domItemsRef.current.delete(key);
  }, []);

  const onExitEnd = useCallback((key: string) => {
    setExiting((cur) => (cur.some((e) => e.key === key) ? cur.filter((e) => e.key !== key) : cur));
  }, []);

  // ── Measure + FLIP every commit ─────────────────────────────────────────
  useLayoutEffect(() => {
    const leavingKeys = new Set(exiting.map((e) => e.key));
    const reduce = prefersReducedMotion();
    const containerTop = containerRef.current?.getBoundingClientRect().top ?? 0;
    const nextOffsets = new Map<string, number>();

    for (const [key, el] of domItemsRef.current) {
      if (leavingKeys.has(key)) continue;
      const rect = el.getBoundingClientRect();
      const topOffset = rect.top - containerTop;
      const prev = topOffsetsRef.current.get(key);
      if (!reduce && prev !== undefined && prev !== topOffset) {
        applyRestackGlide(el, prev - topOffset);
      }
      nextOffsets.set(key, topOffset);
    }
    topOffsetsRef.current = nextOffsets;
  });

  // ── Assemble entries ─────────────────────────────────────────────────────
  const liveKeys = new Set(currentKeys);
  const entries: ListFlipRow<T>[] = [
    ...items.map((item) => {
      const key = getKey(item);
      return {
        key,
        item,
        entering: enteringKeys.has(key),
        leaving: false as const,
      };
    }),
    // Defensive key filter: a ghost colliding with a live key would break render keying.
    ...exiting
      .filter((e) => !liveKeys.has(e.key))
      .map((e) => ({
        key: e.key,
        item: e.item,
        entering: false as const,
        leaving: true as const,
        style:
          e.topOffset == null
            ? ({ position: 'absolute', top: 0, left: 0, right: 0 } satisfies CSSProperties)
            : ({
                position: 'absolute',
                top: `${e.topOffset}px`,
                left: 0,
                right: 0,
              } satisfies CSSProperties),
      })),
  ];

  return { entries, registerItem, onExitEnd };
}
