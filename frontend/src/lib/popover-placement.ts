/**
 * Pure placement math for anchored floating surfaces (dropdowns, popovers, menus).
 *
 * All surfaces that open anchored to a trigger element use this to decide
 * where to position their portaled panel. The math is DOM-free and fully
 * unit-testable. Converged surfaces (all portal to <body>):
 *   InfoTip, SelectMenu, OverflowMenu, CardRowMenu, FilterPopover,
 *   DeckFiltersPopover, SortPopover, Legend, CardContextMenu (playtest),
 *   MobileZonesPanel (playtest), DeckDisplay ToolbarPopover, CardSlot tooltip.
 *
 * Policy
 * ------
 *   Prefer opening BELOW the trigger, right-aligned (for most menus) or
 *   left-aligned (for sort/filter popovers that open wide). Flip ABOVE when
 *   there is not enough room below. Clamp so the panel never escapes the safe
 *   viewport on any edge.
 *
 * Safe viewport
 * -------------
 *   "On-screen" is not the raw viewport — it's the visible area after
 *   subtracting sticky chrome:
 *
 *     Top:    sticky site-header on desktop (3.25 rem ≈ 52px), gone on mobile.
 *             Query it live via `getBoundingClientRect()` on `.site-header`.
 *     Bottom: mobile tab-bar (3.5 rem ≈ 56px) at ≤1024px, gone on desktop.
 *             Query it live via `getBoundingClientRect()` on `.mobile-tab-bar`.
 *             Plus `--keyboard-inset` when the on-screen keyboard is up
 *             (the CSS variable is the single source of truth — read it from
 *             `document.documentElement`).
 *     Left/Right: notch safe-area insets, read from `--safe-left`/`--safe-right`
 *             on `<html>` (tokens.css), plus EDGE_PAD as the minimum margin.
 *
 * This file is imported by React components that portal their panels to
 * `<body>` and call `computePopoverPlacement()` in a `useLayoutEffect` after
 * the panel renders.
 */

/** Minimum gap between panel edge and safe-viewport edge (px). */
const EDGE_PAD = 8;

/** Minimum vertical space below trigger to prefer opening downward (px). */
const MIN_BELOW_SPACE = 160;

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SafeViewport {
  /** Top of the usable area (px from viewport top), after sticky header. */
  top: number;
  /** Bottom of the usable area (px from viewport top), after bottom nav + keyboard. */
  bottom: number;
  /** Left boundary (px from viewport left). */
  left: number;
  /** Right boundary (px from viewport right). */
  right: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

/**
 * Alignment preference.
 *   - 'right'  → panel right edge aligns to trigger right edge (default for menus)
 *   - 'left'   → panel left edge aligns to trigger left edge (default for wide panels)
 */
export type PopoverAlign = 'right' | 'left';

/** The resolved CSS fixed-position coordinates for the panel. */
export interface PopoverPlacement {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  /** When true the panel opens above the trigger (for animation transform-origin). */
  opensAbove: boolean;
}

/**
 * Compute the `position: fixed` coordinates for a popover panel.
 *
 * @param anchor          Trigger element's `getBoundingClientRect()`.
 * @param panel           Rendered panel dimensions (can be estimated before render).
 * @param safe            Safe viewport boundaries (use `getSafeViewport()`).
 * @param align           Horizontal alignment preference ('right' or 'left').
 * @param gap             Vertical gap between trigger and panel edge (px).
 * @param viewportHeight  Raw `window.innerHeight`; pass explicitly for testability.
 * @param viewportWidth   Raw `window.innerWidth`; pass explicitly for testability.
 */
export function computePopoverPlacement(
  anchor: AnchorRect,
  panel: PopoverSize,
  safe: SafeViewport,
  align: PopoverAlign = 'right',
  gap = 6,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : safe.bottom,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : safe.right
): PopoverPlacement {
  const vw = safe.right; // right boundary doubles as "max right px"

  // ── Vertical ────────────────────────────────────────────────────────────────
  const spaceBelow = safe.bottom - anchor.bottom;
  const spaceAbove = anchor.top - safe.top;

  const opensAbove = spaceBelow < MIN_BELOW_SPACE && spaceBelow < spaceAbove;

  let top: number | undefined;
  let bottom: number | undefined;

  if (opensAbove) {
    // `position: fixed; bottom` is measured from the viewport bottom edge.
    bottom = viewportHeight - anchor.top + gap;
    // If it would go off the top of the safe viewport, clamp to top instead.
    const wouldBeTop = anchor.top - gap - panel.height;
    if (wouldBeTop < safe.top + EDGE_PAD) {
      bottom = undefined;
      top = safe.top + EDGE_PAD;
    }
  } else {
    top = anchor.bottom + gap;
    // If it overflows the bottom safe edge, clamp.
    if (top + panel.height > safe.bottom - EDGE_PAD) {
      top = Math.max(safe.top + EDGE_PAD, safe.bottom - EDGE_PAD - panel.height);
    }
  }

  // ── Horizontal ──────────────────────────────────────────────────────────────
  let left: number | undefined;
  let right: number | undefined;

  // Minimum CSS `right` offset that keeps the panel clear of the right
  // safe-area inset (notch in landscape) plus the edge pad.
  const minRight = viewportWidth - safe.right + EDGE_PAD;

  if (align === 'right') {
    // Right-align: panel's right edge at trigger's right edge.
    right = Math.max(minRight, viewportWidth - anchor.right);
    // Verify it won't clip the left safe edge.
    const computedLeft = anchor.right - panel.width;
    if (computedLeft < safe.left + EDGE_PAD) {
      // Flip to left-align instead.
      right = undefined;
      left = Math.max(safe.left + EDGE_PAD, anchor.left);
    }
  } else {
    // Left-align: panel's left edge at trigger's left edge.
    left = Math.max(safe.left + EDGE_PAD, anchor.left);
    // Verify it won't clip the right safe edge.
    if (left + panel.width > vw - EDGE_PAD) {
      // Flip to right-align instead.
      left = undefined;
      right = Math.max(minRight, viewportWidth - anchor.right);
    }
  }

  return { top, bottom, left, right, opensAbove };
}

/**
 * Read the current safe viewport from the live DOM.
 *
 * Queries:
 *   - `.site-header`   — sticky desktop header (hidden on mobile, so height 0)
 *   - `.mobile-tab-bar` — mobile bottom nav (hidden on desktop, so height 0)
 *   - `--keyboard-inset` on `<html>` — on-screen keyboard gap (from lib/keyboard.ts)
 *
 * The return value uses absolute viewport pixel coordinates (same space as
 * `getBoundingClientRect()`), so it can be compared directly with anchor rects.
 *
 * On desktop: top = header bottom, bottom = window.innerHeight - 0 - keyboardInset
 * On mobile:  top = 0 (no header), bottom = window.innerHeight - tabBarH - keyboardInset
 */
export function getSafeViewport(): SafeViewport {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Sticky site header (desktop only; display:none on mobile → height 0).
  const headerEl = document.querySelector<HTMLElement>('.site-header');
  const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 0;
  const safeTop = Math.max(0, headerBottom);

  // Mobile bottom tab bar (display:none on desktop → height 0).
  const tabBarEl = document.querySelector<HTMLElement>('.mobile-tab-bar');
  const tabBarHeight = tabBarEl ? tabBarEl.getBoundingClientRect().height : 0;

  // On-screen keyboard inset (maintained by lib/keyboard.ts) + notch
  // safe-area insets (tokens.css resolves env() into --safe-left/right).
  const rootStyle = getComputedStyle(document.documentElement);
  const kbInset = parseFloat(rootStyle.getPropertyValue('--keyboard-inset')) || 0;
  const notchLeft = parseFloat(rootStyle.getPropertyValue('--safe-left')) || 0;
  const notchRight = parseFloat(rootStyle.getPropertyValue('--safe-right')) || 0;

  const safeBottom = vh - tabBarHeight - kbInset;

  return {
    top: safeTop,
    bottom: Math.max(safeTop, safeBottom),
    left: notchLeft,
    right: vw - notchRight,
  };
}
