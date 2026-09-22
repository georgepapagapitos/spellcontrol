// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptics, setHapticsEnabled } from './haptics';

const vibrate = vi.fn();

function installVibrate(fn: unknown): void {
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: fn });
}

beforeEach(() => {
  vibrate.mockReset().mockReturnValue(true);
  installVibrate(vibrate);
  setHapticsEnabled(true);
});

afterEach(() => {
  setHapticsEnabled(true);
});

describe('haptics', () => {
  it('fires a distinct pattern per cue', () => {
    haptics.tap();
    haptics.success();
    haptics.warning();
    haptics.lethal();
    haptics.eliminate();
    haptics.bump();

    expect(vibrate.mock.calls.map((c) => c[0])).toEqual([
      10,
      40,
      [20, 30, 20],
      [20, 40, 60],
      [30, 30, 30],
      25,
    ]);
  });

  it('stays silent once disabled, and resumes when re-enabled', () => {
    setHapticsEnabled(false);
    haptics.tap();
    haptics.lethal();
    expect(vibrate).not.toHaveBeenCalled();

    setHapticsEnabled(true);
    haptics.tap();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  // iOS Safari has no Vibration API at all. A missing cue is decoration not
  // firing — it must never become an exception the caller has to handle.
  it('no-ops where the browser has no Vibration API', () => {
    installVibrate(undefined);
    expect(() => haptics.success()).not.toThrow();
  });

  // Some browsers throw when vibrate() is called outside a user gesture.
  it('swallows a throwing vibrate', () => {
    installVibrate(() => {
      throw new Error('not allowed outside a user gesture');
    });
    expect(() => haptics.warning()).not.toThrow();
  });
});
