// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  HOVER_HIDE_DELAY_MS,
  HOVER_INTENT_DELAY_MS,
  PEEK_SUPPRESS_ATTR,
  isPeekSuppressed,
} from './hover-intent';

describe('hover-intent', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('exposes a sane dwell delay', () => {
    // A guardrail, not a spec: long enough to read as intent, short enough to
    // not feel laggy. If this ever flips outside the band, it's a deliberate
    // product call worth re-reading.
    expect(HOVER_INTENT_DELAY_MS).toBeGreaterThanOrEqual(150);
    expect(HOVER_INTENT_DELAY_MS).toBeLessThanOrEqual(600);
  });

  it('keeps the hide grace shorter than the show delay', () => {
    // The hide grace only absorbs brief exits; it must clear well before a fresh
    // dwell would re-show, or a deliberate move away feels sticky.
    expect(HOVER_HIDE_DELAY_MS).toBeGreaterThan(0);
    expect(HOVER_HIDE_DELAY_MS).toBeLessThan(HOVER_INTENT_DELAY_MS);
  });

  describe('isPeekSuppressed', () => {
    it('is false for a null target', () => {
      expect(isPeekSuppressed(null)).toBe(false);
    });

    it('is false for a non-Element target', () => {
      expect(isPeekSuppressed({} as EventTarget)).toBe(false);
    });

    it('is false for an element outside any suppression zone', () => {
      const el = document.createElement('div');
      document.body.append(el);
      expect(isPeekSuppressed(el)).toBe(false);
    });

    it('is true for the marked element itself', () => {
      const el = document.createElement('button');
      el.setAttribute(PEEK_SUPPRESS_ATTR, '');
      document.body.append(el);
      expect(isPeekSuppressed(el)).toBe(true);
    });

    it('is true for a descendant of a marked element', () => {
      const zone = document.createElement('div');
      zone.setAttribute(PEEK_SUPPRESS_ATTR, '');
      const icon = document.createElement('svg');
      zone.append(icon);
      document.body.append(zone);
      expect(isPeekSuppressed(icon)).toBe(true);
    });
  });
});
