// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dismissCrossDeckMove,
  dismissCrossDeckMoves,
  isCrossDeckMoveDismissed,
  restoreCrossDeckMoves,
} from './between-decks-dismissed';

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

  it('dismisses a whole batch at once and leaves others visible', () => {
    dismissCrossDeckMoves(['a:One:b', 'a:Two:b']);
    expect(isCrossDeckMoveDismissed('a:One:b')).toBe(true);
    expect(isCrossDeckMoveDismissed('a:Two:b')).toBe(true);
    expect(isCrossDeckMoveDismissed('a:Three:b')).toBe(false);
  });

  it('restores a batch (undo) without disturbing separately dismissed ids', () => {
    dismissCrossDeckMove('a:Kept:b');
    dismissCrossDeckMoves(['a:One:b', 'a:Two:b']);
    restoreCrossDeckMoves(['a:One:b', 'a:Two:b']);
    expect(isCrossDeckMoveDismissed('a:One:b')).toBe(false);
    expect(isCrossDeckMoveDismissed('a:Two:b')).toBe(false);
    expect(isCrossDeckMoveDismissed('a:Kept:b')).toBe(true);
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
