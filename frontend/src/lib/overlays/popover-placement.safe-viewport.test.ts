// @vitest-environment happy-dom
/**
 * getSafeViewport() needs real `window`/`document` globals, so it gets its
 * own happy-dom-scoped file — popover-placement.test.ts stays on the default
 * `node` environment because computePopoverPlacement()'s own tests rely on
 * `window` being genuinely undefined (its viewportWidth/viewportHeight
 * defaults fall back to the `safe` rect only when `window` doesn't exist;
 * forcing happy-dom into that file would silently swap those defaults for
 * happy-dom's own window.innerWidth/innerHeight and break assertions that
 * pin values against the `safe` rect).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getSafeViewport } from './popover-placement';

describe('getSafeViewport', () => {
  const origGetComputedStyle = globalThis.getComputedStyle;

  afterEach(() => {
    globalThis.getComputedStyle = origGetComputedStyle;
    document.body.replaceChildren();
  });

  it('clamps safeTop to the --safe-top notch inset when the sticky header is absent', () => {
    // No .site-header in the DOM (mobile/≤1024px) → headerBottom is 0, so
    // safeTop must fall back to the notch inset instead of losing it.
    globalThis.getComputedStyle = ((el: Element) => {
      if (el === document.documentElement) {
        return {
          getPropertyValue: (prop: string) => (prop === '--safe-top' ? '24px' : ''),
        } as CSSStyleDeclaration;
      }
      return origGetComputedStyle(el);
    }) as typeof getComputedStyle;

    expect(getSafeViewport().top).toBe(24);
  });

  it('prefers the taller of header bottom vs notch inset', () => {
    const header = document.createElement('div');
    header.className = 'site-header';
    document.body.appendChild(header);
    header.getBoundingClientRect = () => ({ bottom: 52 }) as DOMRect;

    globalThis.getComputedStyle = ((el: Element) => {
      if (el === document.documentElement) {
        return {
          getPropertyValue: (prop: string) => (prop === '--safe-top' ? '10px' : ''),
        } as CSSStyleDeclaration;
      }
      return origGetComputedStyle(el);
    }) as typeof getComputedStyle;

    expect(getSafeViewport().top).toBe(52);
  });
});
