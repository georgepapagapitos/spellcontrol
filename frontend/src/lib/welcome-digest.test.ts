// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildWelcomeDigest,
  getBinderMoveLog,
  getDigestBaseline,
  isDigestDismissedThisSession,
  logBinderMoves,
  markDigestDismissedThisSession,
  setDigestBaseline,
} from './welcome-digest';
import { dayKey } from './value-history';

const T0 = new Date(2026, 5, 1, 12).getTime();
const DAY = 86400000;

const move = (name: string) => ({ cardName: name, fromBinder: 'Bulk', toBinder: 'High Value' });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('binder move log', () => {
  it('appends with a timestamp and reads back', () => {
    logBinderMoves([move('Sol Ring')], T0);
    expect(getBinderMoveLog()).toEqual([
      { cardName: 'Sol Ring', fromBinder: 'Bulk', toBinder: 'High Value', at: T0 },
    ]);
  });

  it('prunes entries older than 30 days on write', () => {
    logBinderMoves([move('Old Move')], T0);
    logBinderMoves([move('New Move')], T0 + 31 * DAY);
    expect(getBinderMoveLog().map((m) => m.cardName)).toEqual(['New Move']);
  });

  it('caps the log at the newest 100 entries', () => {
    logBinderMoves(
      Array.from({ length: 110 }, (_, i) => move(`Card ${i}`)),
      T0
    );
    const log = getBinderMoveLog();
    expect(log).toHaveLength(100);
    expect(log[0].cardName).toBe('Card 10');
    expect(log[99].cardName).toBe('Card 109');
  });

  it('ignores an empty batch', () => {
    logBinderMoves([], T0);
    expect(localStorage.getItem('spellcontrol:binder-move-log')).toBeNull();
  });
});

describe('baseline', () => {
  it('round-trips with a day key', () => {
    setDigestBaseline(1234.5, T0);
    expect(getDigestBaseline()).toEqual({ at: T0, day: dayKey(T0), value: 1234.5 });
  });

  it('is null when unset or corrupt', () => {
    expect(getDigestBaseline()).toBeNull();
    localStorage.setItem('spellcontrol:value-digest-seen', '{nope');
    expect(getDigestBaseline()).toBeNull();
  });
});

describe('session dismissal', () => {
  it('is per-session-storage', () => {
    expect(isDigestDismissedThisSession()).toBe(false);
    markDigestDismissedThisSession();
    expect(isDigestDismissedThisSession()).toBe(true);
  });
});

describe('buildWelcomeDigest', () => {
  it('is null without a baseline (first run)', () => {
    logBinderMoves([move('Sol Ring')], T0);
    expect(buildWelcomeDigest(500)).toBeNull();
  });

  it('is null when the delta rounds below a dollar and nothing moved', () => {
    setDigestBaseline(100, T0);
    expect(buildWelcomeDigest(100.4)).toBeNull();
  });

  it('reports the value delta since the baseline', () => {
    setDigestBaseline(100, T0);
    const digest = buildWelcomeDigest(118);
    expect(digest?.deltaAmount).toBe(18);
    expect(digest?.moves).toEqual([]);
  });

  it('includes only moves logged after the baseline', () => {
    logBinderMoves([move('Before Baseline')], T0 - DAY);
    setDigestBaseline(100, T0);
    logBinderMoves([move('After Baseline')], T0 + DAY);
    const digest = buildWelcomeDigest(100);
    expect(digest?.moves.map((m) => m.cardName)).toEqual(['After Baseline']);
    // Moves alone justify a digest even with a steady value.
    expect(digest?.deltaAmount).toBe(0);
  });
});
