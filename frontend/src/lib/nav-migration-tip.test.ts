// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissNavTip, shouldShowNavTip } from './nav-migration-tip';

beforeEach(() => {
  localStorage.clear();
});

describe('shouldShowNavTip', () => {
  it('returning user, never dismissed → true', () => {
    expect(shouldShowNavTip(true)).toBe(true);
  });

  it('returning user, already dismissed → false', () => {
    dismissNavTip();
    expect(shouldShowNavTip(true)).toBe(false);
  });

  it('brand-new user → false regardless of the dismiss flag', () => {
    expect(shouldShowNavTip(false)).toBe(false);
    dismissNavTip();
    expect(shouldShowNavTip(false)).toBe(false);
  });

  it('uses the documented localStorage key', () => {
    dismissNavTip();
    expect(localStorage.getItem('sc-seen-nav-v2-tip')).toBe('1');
  });

  it('tolerates a storage read failure by defaulting to hidden', () => {
    // happy-dom's localStorage isn't `instanceof Storage`, so the spy must
    // target the instance itself, not Storage.prototype (which is a no-op
    // here — see local-storage.test.ts's equivalent test, which happens to
    // pass either way since its fallback also covers a plain absent key).
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(shouldShowNavTip(true)).toBe(false);
    spy.mockRestore();
  });

  it('dismissNavTip tolerates a storage write failure silently', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => dismissNavTip()).not.toThrow();
    spy.mockRestore();
  });
});
