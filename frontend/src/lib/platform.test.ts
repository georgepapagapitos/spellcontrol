// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { isTouchDevice } from './platform';

function setMaxTouchPoints(n: number): void {
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: n });
}

afterEach(() => {
  setMaxTouchPoints(0);
});

describe('isTouchDevice', () => {
  it('is false on a pointer-only device', () => {
    setMaxTouchPoints(0);
    expect(isTouchDevice()).toBe(false);
  });

  it('is true once the device reports any touch points', () => {
    setMaxTouchPoints(1);
    expect(isTouchDevice()).toBe(true);
  });

  // A touchscreen laptop reports touch points while the user is on a mouse.
  // Touch-only affordances gated on this simply never fire there, which is
  // why the check is deliberately not combined with a hover media query.
  it('is true on a multi-touch screen', () => {
    setMaxTouchPoints(10);
    expect(isTouchDevice()).toBe(true);
  });
});
