// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dismissCrossDeckMove, isCrossDeckMoveDismissed } from './between-decks-dismissed';

describe('between-decks-dismissed', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns false for an undismissed suggestion', () => {
    expect(isCrossDeckMoveDismissed('donor:Sol Ring:target')).toBe(false);
  });

  it('returns true after dismissCrossDeckMove is called', () => {
    dismissCrossDeckMove('donor:Sol Ring:target');
    expect(isCrossDeckMoveDismissed('donor:Sol Ring:target')).toBe(true);
  });

  it('does not dismiss other suggestion ids', () => {
    dismissCrossDeckMove('a:Card:b');
    expect(isCrossDeckMoveDismissed('a:Other:b')).toBe(false);
  });

  it('is idempotent', () => {
    dismissCrossDeckMove('a:Card:b');
    dismissCrossDeckMove('a:Card:b');
    expect(isCrossDeckMoveDismissed('a:Card:b')).toBe(true);
  });

  it('survives corrupted localStorage without throwing', () => {
    localStorage.setItem('between-decks-dismissed-ids', 'not-json!!');
    expect(() => isCrossDeckMoveDismissed('a:Card:b')).not.toThrow();
    expect(isCrossDeckMoveDismissed('a:Card:b')).toBe(false);
  });

  it('survives non-array JSON without throwing', () => {
    localStorage.setItem('between-decks-dismissed-ids', '{"foo":1}');
    expect(() => isCrossDeckMoveDismissed('a:Card:b')).not.toThrow();
    expect(isCrossDeckMoveDismissed('a:Card:b')).toBe(false);
  });
});
