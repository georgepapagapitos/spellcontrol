// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetForTests,
  installChunkReload,
  isChunkLoadError,
  isReloadingForNewBuild,
  recoverFromChunkError,
  reloadForNewBuild,
} from './chunk-reload';

// The exact wording each browser (and Vite's preload helper) throws for a
// chunk a deploy replaced. The CSS one is the most common in production.
const WORDINGS = [
  ['Chromium', 'Failed to fetch dynamically imported module: https://x/assets/HomePage-abc.js'],
  ['Firefox', 'error loading dynamically imported module: https://x/assets/a.js'],
  ['Safari', 'Importing a module script failed.'],
  ['Vite CSS preload', 'Unable to preload CSS for /assets/DeckEditorPage-Cq1x2a.css'],
] as const;

describe('isChunkLoadError', () => {
  it.each(WORDINGS)('recognizes the %s wording', (_, message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('recognizes a ChunkLoadError by name, and a thrown string', () => {
    const e = new Error('Loading chunk 7 failed');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
    expect(isChunkLoadError('Failed to fetch dynamically imported module: x')).toBe(true);
  });

  it('leaves every other error to the normal screen', () => {
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
    expect(isChunkLoadError(new Error('Unable to load deck'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('reloading for the new build', () => {
  const originalLocation = window.location;
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessionStorage.clear();
    _resetForTests();
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  describe('reloadForNewBuild', () => {
    it('reloads once, then not again within the minute', () => {
      expect(reloadForNewBuild(1_000_000)).toBe(true);
      expect(isReloadingForNewBuild()).toBe(true);
      expect(reloadForNewBuild(1_030_000)).toBe(false);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads again once the minute has passed', () => {
      reloadForNewBuild(1_000_000);
      expect(reloadForNewBuild(1_061_000)).toBe(true);
      expect(reload).toHaveBeenCalledTimes(2);
    });

    it('does not reload when it cannot remember doing so (a loop would be worse)', () => {
      vi.stubGlobal('sessionStorage', {
        getItem: () => {
          throw new Error('storage disabled');
        },
        setItem: () => {},
      });
      expect(reloadForNewBuild()).toBe(false);
      expect(isReloadingForNewBuild()).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('recoverFromChunkError', () => {
    const stale = new TypeError(WORDINGS[0][1]);

    it('spends one reload on a failure that surfaces on several paths', () => {
      expect(recoverFromChunkError(stale)).toBe(true);
      expect(recoverFromChunkError(stale)).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('never reloads for an error that is not a chunk load', () => {
      expect(recoverFromChunkError(new Error('boom'))).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    });

    it('reports no recovery when the reload a minute ago did not help', () => {
      sessionStorage.setItem('sc-chunk-reload-at', String(Date.now()));
      expect(recoverFromChunkError(stale)).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('window listeners', () => {
    beforeAll(() => installChunkReload());

    function preloadError(payload: unknown): Event {
      const e = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload });
      window.dispatchEvent(e);
      return e;
    }
    function rejection(reason: unknown): Event {
      const e = Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason });
      window.dispatchEvent(e);
      return e;
    }

    it.each(WORDINGS)('a vite:preloadError with the %s wording reloads once', (_, message) => {
      const e = preloadError(new Error(message));
      expect(reload).toHaveBeenCalledTimes(1);
      // Left uncancelled: cancelling would hand the page an undefined module.
      expect(e.defaultPrevented).toBe(false);
    });

    it.each(WORDINGS)(
      'an unhandled rejection with the %s wording reloads once and is handled',
      (_, message) => {
        const e = rejection(new TypeError(message));
        expect(reload).toHaveBeenCalledTimes(1);
        expect(e.defaultPrevented).toBe(true);
      }
    );

    it('the same failure arriving as a preload event then a rejection reloads once', () => {
      const err = new Error(WORDINGS[3][1]);
      preloadError(err);
      const e = rejection(err);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);
    });

    it('keeps the loop guard: a failure right after the reload is left to surface', () => {
      sessionStorage.setItem('sc-chunk-reload-at', String(Date.now()));
      preloadError(new Error(WORDINGS[3][1]));
      const e = rejection(new TypeError(WORDINGS[0][1]));
      expect(reload).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });

    it('ignores rejections and preload errors that are not chunk loads', () => {
      preloadError(new Error('boom'));
      const e = rejection(new Error('network down'));
      expect(reload).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });
  });
});
