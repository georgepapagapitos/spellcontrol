// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MAX_NARROW,
  ZOOM_MIN,
  clampZoom,
  readStoredZoom,
  zoomBucket,
  zoomMinCol,
} from './grid-zoom';

const KEY = 'test-grid-zoom';

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
