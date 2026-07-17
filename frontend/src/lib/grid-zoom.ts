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
  mobile: [90, 110, 135, 165, 200, 240],
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
