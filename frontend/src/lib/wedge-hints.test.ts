// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismissBinderHint,
  dismissResyncHint,
  shouldShowBinderHint,
  shouldShowResyncHint,
} from './wedge-hints';

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

  it('dismissing the resync hint does not dismiss the binder hint', () => {
    dismissResyncHint();
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

describe('shouldShowResyncHint', () => {
  it('empty deck → false regardless of dismiss state', () => {
    expect(shouldShowResyncHint(false)).toBe(false);
    dismissResyncHint();
    expect(shouldShowResyncHint(false)).toBe(false);
  });

  it('non-empty deck, never dismissed → true', () => {
    expect(shouldShowResyncHint(true)).toBe(true);
  });

  it('non-empty deck, already dismissed → false forever', () => {
    dismissResyncHint();
    expect(shouldShowResyncHint(true)).toBe(false);
  });

  it('dismissing the binder hint does not dismiss the resync hint', () => {
    dismissBinderHint();
    expect(shouldShowResyncHint(true)).toBe(true);
  });

  it('uses its own documented localStorage key', () => {
    dismissResyncHint();
    expect(localStorage.getItem('sc-hint-deck-resync-v1')).toBe('1');
  });

  it('tolerates a storage read failure by defaulting to hidden', () => {
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(shouldShowResyncHint(true)).toBe(false);
    spy.mockRestore();
  });

  it('dismissResyncHint tolerates a storage write failure silently', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => dismissResyncHint()).not.toThrow();
    spy.mockRestore();
  });
});
