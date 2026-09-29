import { useEffect, type RefObject } from 'react';

/**
 * F10: makes every sibling along the path from `ref`'s element up to
 * `<body>` `inert` (native `inert` already hides them from the
 * accessibility tree, no extra ARIA needed) while `active` — the app-shell
 * equivalent of a modal dialog's top-layer isolation, for a full-screen
 * overlay that isn't portaled to `<body>` itself (the local life-counter
 * board: `GameBoard` renders inline under the Play page's own tab content,
 * which sits under the app shell's `Header`/`MobileTabBar`/etc, so a plain
 * focus trap on the board's own subtree still leaves Tab free to walk into
 * everything alongside it).
 *
 * Elements marked `data-inert-exempt` are skipped at every level — the toast
 * viewport, which must stay reachable and announced while an overlay using
 * this hook is open.
 *
 * Deliberately a one-shot walk on mount/unmount, not a MutationObserver: the
 * tree along this path doesn't change shape while a full-screen overlay
 * owns the screen (nothing else should be opening behind it).
 *
 * `boundarySelector`, when given, stops the walk once it reaches the nearest
 * ancestor matching it instead of continuing to `<body>` — for an inner
 * overlay (the win celebration) nested inside an outer one that already owns
 * everything past its own root (the board). A selector, not a ref: React
 * runs child effects before parent effects, so when both mount in the same
 * commit (a board that mounts already finished) the inner instance can run
 * FIRST and claim ownership of an outer sibling the outer instance was going
 * to inert anyway — then hand it back (un-inert it) the moment the inner
 * overlay closes, while the outer one is still mounted. Resolving the
 * boundary by selector at effect time sidesteps that race entirely, rather
 * than depending on which of the two effects happens to run first.
 */
export function useBackgroundInert(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  boundarySelector?: string
): void {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const stopAt = boundarySelector ? el.closest(boundarySelector) : null;
    const owned: HTMLElement[] = [];
    let node: HTMLElement | null = el;
    while (node && node !== document.body && node !== stopAt) {
      const parent: HTMLElement | null = node.parentElement;
      if (parent) {
        for (const sibling of Array.from(parent.children)) {
          if (sibling === node) continue;
          if (!(sibling instanceof HTMLElement)) continue;
          if (sibling.hasAttribute('data-inert-exempt')) continue;
          // Idempotent: an outer instance of this hook (the board) may have
          // already inerted this sibling before an inner one (the win
          // celebration) walks the same path — only the owner that actually
          // set it should be the one that clears it.
          if (!sibling.inert) {
            sibling.inert = true;
            owned.push(sibling);
          }
        }
      }
      node = parent;
    }
    return () => {
      for (const sibling of owned) sibling.inert = false;
    };
  }, [active, ref, boundarySelector]);
}
