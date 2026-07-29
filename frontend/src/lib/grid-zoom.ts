// Stepped card-size zoom shared by the collection and deck grids — the
// magnifier −/+ control that replaced the 1×/2×/3× presets.
//
// Each step maps to a min column width fed into the grid layout; two
// ladders curate the range per viewport tier (>1024px vs ≤1024px). Steps
// 1/3/5 reproduce the retired 1×/2×/3× widths exactly, so a migrated
// preference renders the same grid it did before.

export const ZOOM_MIN = 0;
export const ZOOM_MAX = 5;
// On phones (≤640px) the top steps all collapse to a single full-width
// column, so + stops where further presses no longer change the layout.
export const ZOOM_MAX_NARROW = 4;
export const ZOOM_DEFAULT = 1;

const MIN_COL: Record<'desktop' | 'mobile', number[]> = {
  desktop: [120, 150, 185, 220, 265, 320],
  // Step 0 was 90px, which floors to the same 3 columns as step 1 on a 360px
  // phone — so at ZOOM_DEFAULT (1) there was no smaller layout to reach and −
  // could only ever be disabled. 78px clears the boundary (4 columns at 360px,
  // 5 at 480px) and is the smallest rung that still reads as a card. Steps
  // 1/3/5 are untouched: they reproduce the retired 1×/2×/3× widths exactly
  // and `readStoredZoom` migrates legacy prefs onto them.
  mobile: [78, 110, 135, 165, 200, 240],
};

/** Clamp a zoom step to the range reachable on the current viewport. */
export function clampZoom(step: number, isNarrow: boolean): number {
  return Math.min(Math.max(step, ZOOM_MIN), isNarrow ? ZOOM_MAX_NARROW : ZOOM_MAX);
}

/** Min grid-column width in px for a zoom step. */
export function zoomMinCol(step: number, tier: 'desktop' | 'mobile'): number {
  return MIN_COL[tier][Math.min(Math.max(step, ZOOM_MIN), ZOOM_MAX)];
}

/**
 * Column gap every card grid renders with, in px. The JS column math and the
 * CSS `gap` MUST be the same number: they were independently hand-picked (JS
 * used 8 below 1024px and 10 above; the collection grid rendered 10 either
 * way; the deck/list CSS used 0.65rem = 10.4px), which made the same zoom
 * step render 4 columns in the collection grid and 3 in the deck grid at a
 * 390px container. Exposed to CSS as `--card-grid-gap` (tokens.css).
 */
export const GRID_GAP_PX = 10;

/**
 * Which ladder a grid uses, from the grid's own measured width. This is a
 * *container* query on purpose — the CSS used a `@media` viewport query, so a
 * grid narrower than the viewport (a sidebar, a dialog) picked the desktop
 * ladder while the JS picked mobile. Callers measure the element and pass the
 * width, so both paths now resolve the tier identically.
 */
export function zoomTier(width: number): 'desktop' | 'mobile' {
  return width <= 1024 ? 'mobile' : 'desktop';
}

/**
 * Columns a step renders at a given container width — the same floor-division
 * the CSS `repeat(auto-fill, minmax(min(var(--card-min), 100%), 1fr))`
 * performs, so it predicts the JS-virtualized and CSS-driven grids alike.
 */
export function zoomCols(step: number, tier: 'desktop' | 'mobile', width: number): number {
  // `min(--card-min, 100%)` — a min wider than the container collapses to one
  // full-width column rather than overflowing.
  const minCol = Math.min(zoomMinCol(step, tier), width);
  return Math.max(1, Math.floor((width + GRID_GAP_PX) / (minCol + GRID_GAP_PX)));
}

/**
 * The next step in `dir` that actually changes the column count.
 *
 * The ladder is a set of px minimums, but what the user sees is a whole number
 * of columns — so flooring makes adjacent steps collapse onto the same layout
 * at most widths. At a 360px container, steps 0 and 1 both render 3 columns
 * and `ZOOM_DEFAULT` is 1, so the very first − press was a visible no-op on a
 * phone; 9 of 13 common widths had at least one such dead pair, and *which*
 * step is dead moves with the width, so no static re-tuning of the ladder can
 * fix it. Skipping them keeps the px ladder (and its 1×/2×/3× parity) intact
 * while guaranteeing every enabled press changes the layout.
 *
 * Returns `from` unchanged when no distinct step remains — the caller disables
 * the button, per the standing "range ends disable, never hide" ruling.
 */
export function nextZoomStep(
  from: number,
  dir: 1 | -1,
  tier: 'desktop' | 'mobile',
  width: number,
  min: number,
  max: number
): number {
  // Pre-measure (width 0): fall back to plain arithmetic so the control isn't
  // dead on first paint, before the ResizeObserver has reported.
  if (width <= 0) return Math.min(Math.max(from + dir, min), max);
  const startCols = zoomCols(from, tier, width);
  for (let s = from + dir; s >= min && s <= max; s += dir) {
    if (zoomCols(s, tier, width) !== startCols) return s;
  }
  return from;
}

/**
 * Coarse size bucket for CSS that scales grid-cell chrome (badges, qty
 * pills) with the card — reuses the legacy grid-1x/2x/3x class names.
 */
export function zoomBucket(step: number): '1x' | '2x' | '3x' {
  return step >= 4 ? '3x' : step >= 2 ? '2x' : '1x';
}

/** Read a persisted zoom step, migrating the legacy '1x'/'2x'/'3x' presets. */
export function readStoredZoom(key: string): number {
  try {
    const v = localStorage.getItem(key);
    if (v === '1x') return 1;
    if (v === '2x') return 3;
    if (v === '3x') return 5;
    if (v && /^\d+$/.test(v)) return Math.min(Math.max(Number(v), ZOOM_MIN), ZOOM_MAX);
  } catch {
    /* ignore */
  }
  return ZOOM_DEFAULT;
}
