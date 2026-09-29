// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MAX_NARROW,
  ZOOM_MIN,
  clampZoom,
  nextZoomStep,
  readStoredZoom,
  zoomBucket,
  zoomCols,
  zoomMinCol,
  zoomTier,
} from './grid-zoom';

const KEY = 'test-grid-zoom';

// Container widths that matter: the 320px floor, common phone widths, the
// tablet/desktop tier boundary, and a couple of desktop sizes.
const WIDTHS = [320, 360, 390, 414, 480, 600, 640, 768, 834, 1024, 1280, 1440, 1920];

describe('zoom stepper never renders a dead press', () => {
  // The ladder is px minimums but the user sees whole columns, so adjacent
  // steps floor onto the same layout at most widths. At 360px steps 0 and 1
  // are both 3 columns and ZOOM_DEFAULT is 1 — which made the very first −
  // press on a phone do visibly nothing. `nextZoomStep` skips those.
  it('still has dead adjacent steps, so the skipping is load-bearing', () => {
    // Steps 2 and 3 both floor to 2 columns at 360px. Lowering step 0 fixed
    // the *default's* dead press, but flooring guarantees collisions remain
    // somewhere at every width — the ladder alone can never be enough.
    expect(zoomCols(2, 'mobile', 360)).toBe(zoomCols(3, 'mobile', 360));
  });

  it('gives the phone default a smaller layout to step down to', () => {
    // Regression guard on the step-0 rung: at 90px it floored to the same 3
    // columns as step 1, leaving − permanently disabled at ZOOM_DEFAULT.
    expect(zoomCols(0, 'mobile', 360)).toBeGreaterThan(zoomCols(1, 'mobile', 360));
  });

  it('changes the column count on every enabled press, at every width', () => {
    for (const width of WIDTHS) {
      const tier = zoomTier(width);
      const max = width <= 640 ? ZOOM_MAX_NARROW : ZOOM_MAX;
      for (let step = ZOOM_MIN; step <= max; step++) {
        for (const dir of [-1, 1] as const) {
          const next = nextZoomStep(step, dir, tier, width, ZOOM_MIN, max);
          // `next === step` means "no distinct layout that way" — the caller
          // renders the button disabled, so there is no press to be dead.
          if (next === step) continue;
          expect(
            zoomCols(next, tier, width),
            `w=${width} step=${step} dir=${dir} landed on an identical layout`
          ).not.toBe(zoomCols(step, tier, width));
        }
      }
    }
  });

  it('always leaves the phone default with a working − press', () => {
    for (const width of WIDTHS.filter((w) => w <= 640)) {
      const next = nextZoomStep(
        ZOOM_DEFAULT,
        -1,
        zoomTier(width),
        width,
        ZOOM_MIN,
        ZOOM_MAX_NARROW
      );
      expect(next, `w=${width}: − from the default is a no-op`).not.toBe(ZOOM_DEFAULT);
    }
  });

  it('reports "no further step" at the ends rather than moving silently', () => {
    // Smallest step at the narrowest container: nothing smaller to reach.
    expect(nextZoomStep(0, -1, 'mobile', 360, ZOOM_MIN, ZOOM_MAX_NARROW)).toBe(0);
  });

  it('falls back to plain arithmetic before the first measure', () => {
    // width 0 = pre-ResizeObserver. The control must not start disabled.
    expect(nextZoomStep(1, -1, 'mobile', 0, ZOOM_MIN, ZOOM_MAX_NARROW)).toBe(0);
    expect(nextZoomStep(1, 1, 'mobile', 0, ZOOM_MIN, ZOOM_MAX_NARROW)).toBe(2);
  });
});

describe('zoomCols', () => {
  it('collapses to one full-width column when the min exceeds the container', () => {
    // Mirrors the CSS `minmax(min(var(--card-min), 100%), 1fr)` clamp.
    expect(zoomCols(ZOOM_MAX, 'desktop', 280)).toBe(1);
  });

  it('is monotonic — a bigger step never yields more columns', () => {
    for (const width of WIDTHS) {
      const tier = zoomTier(width);
      for (let step = ZOOM_MIN; step < ZOOM_MAX; step++) {
        expect(zoomCols(step + 1, tier, width)).toBeLessThanOrEqual(zoomCols(step, tier, width));
      }
    }
  });
});

describe('zoomTier', () => {
  it('switches on the grid’s own width, not the viewport', () => {
    expect(zoomTier(1024)).toBe('mobile');
    expect(zoomTier(1025)).toBe('desktop');
  });
});

describe('zoomMinCol', () => {
  it('is strictly increasing across steps on both tiers', () => {
    for (const tier of ['desktop', 'mobile'] as const) {
      for (let s = ZOOM_MIN; s < ZOOM_MAX; s++) {
        expect(zoomMinCol(s + 1, tier)).toBeGreaterThan(zoomMinCol(s, tier));
      }
    }
  });

  it('matches the legacy 1×/2×/3× widths at steps 1/3/5', () => {
    expect(zoomMinCol(1, 'desktop')).toBe(150);
    expect(zoomMinCol(3, 'desktop')).toBe(220);
    expect(zoomMinCol(5, 'desktop')).toBe(320);
    expect(zoomMinCol(1, 'mobile')).toBe(110);
    expect(zoomMinCol(3, 'mobile')).toBe(165);
    expect(zoomMinCol(5, 'mobile')).toBe(240);
  });

  it('clamps out-of-range steps', () => {
    expect(zoomMinCol(-3, 'desktop')).toBe(zoomMinCol(ZOOM_MIN, 'desktop'));
    expect(zoomMinCol(99, 'mobile')).toBe(zoomMinCol(ZOOM_MAX, 'mobile'));
  });
});

describe('clampZoom', () => {
  it('caps at ZOOM_MAX_NARROW on narrow viewports without touching lower steps', () => {
    expect(clampZoom(ZOOM_MAX, true)).toBe(ZOOM_MAX_NARROW);
    expect(clampZoom(2, true)).toBe(2);
  });

  it('allows the full range on wide viewports and floors at ZOOM_MIN', () => {
    expect(clampZoom(ZOOM_MAX, false)).toBe(ZOOM_MAX);
    expect(clampZoom(-1, false)).toBe(ZOOM_MIN);
  });
});

describe('zoomBucket', () => {
  it('maps step ranges onto the legacy class buckets', () => {
    expect(zoomBucket(0)).toBe('1x');
    expect(zoomBucket(1)).toBe('1x');
    expect(zoomBucket(2)).toBe('2x');
    expect(zoomBucket(3)).toBe('2x');
    expect(zoomBucket(4)).toBe('3x');
    expect(zoomBucket(5)).toBe('3x');
  });
});

describe('readStoredZoom', () => {
  beforeEach(() => localStorage.clear());

  it('migrates the legacy 1x/2x/3x presets to their matching steps', () => {
    localStorage.setItem(KEY, '1x');
    expect(readStoredZoom(KEY)).toBe(1);
    localStorage.setItem(KEY, '2x');
    expect(readStoredZoom(KEY)).toBe(3);
    localStorage.setItem(KEY, '3x');
    expect(readStoredZoom(KEY)).toBe(5);
  });

  it('reads a stored numeric step, clamped to the valid range', () => {
    localStorage.setItem(KEY, '4');
    expect(readStoredZoom(KEY)).toBe(4);
    localStorage.setItem(KEY, '42');
    expect(readStoredZoom(KEY)).toBe(ZOOM_MAX);
  });

  it('falls back to the default on missing or garbage values', () => {
    expect(readStoredZoom(KEY)).toBe(ZOOM_DEFAULT);
    localStorage.setItem(KEY, 'huge');
    expect(readStoredZoom(KEY)).toBe(ZOOM_DEFAULT);
    localStorage.setItem(KEY, '');
    expect(readStoredZoom(KEY)).toBe(ZOOM_DEFAULT);
    localStorage.setItem(KEY, '-2');
    expect(readStoredZoom(KEY)).toBe(ZOOM_DEFAULT);
  });
});
