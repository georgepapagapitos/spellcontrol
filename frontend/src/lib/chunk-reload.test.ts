// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForNewBuild } from './chunk-reload';

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/HomePage-abc.js',
    'error loading dynamically imported module: https://x/assets/a.js',
    'Importing a module script failed.',
  ])('recognizes %s', (message) => {
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
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('reloadForNewBuild', () => {
  const originalLocation = window.location;
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessionStorage.clear();
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

  it('reloads once, then not again within the minute', () => {
    expect(reloadForNewBuild(1_000_000)).toBe(true);
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
    expect(reload).not.toHaveBeenCalled();
  });
});
