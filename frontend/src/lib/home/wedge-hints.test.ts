// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissBinderHint, dismissPlaytestDragHint, shouldShowBinderHint } from './wedge-hints';

beforeEach(() => {
  localStorage.clear();
});

describe('shouldShowBinderHint', () => {
  it('no binder match → false regardless of dismiss state', () => {
    expect(shouldShowBinderHint(false)).toBe(false);
    dismissBinderHint();
    expect(shouldShowBinderHint(false)).toBe(false);
  });

  it('binder match, never dismissed → true', () => {
    expect(shouldShowBinderHint(true)).toBe(true);
  });

  it('binder match, already dismissed → false forever', () => {
    dismissBinderHint();
    expect(shouldShowBinderHint(true)).toBe(false);
  });

  it('dismissing the playtest drag hint does not dismiss the binder hint', () => {
    dismissPlaytestDragHint();
    expect(shouldShowBinderHint(true)).toBe(true);
  });

  it('uses its own documented localStorage key', () => {
    dismissBinderHint();
    expect(localStorage.getItem('sc-hint-binder-location-v1')).toBe('1');
  });

  it('tolerates a storage read failure by defaulting to hidden', () => {
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(shouldShowBinderHint(true)).toBe(false);
    spy.mockRestore();
  });

  it('dismissBinderHint tolerates a storage write failure silently', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => dismissBinderHint()).not.toThrow();
    spy.mockRestore();
  });
});
