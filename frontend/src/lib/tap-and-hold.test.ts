// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_DWELL_MS, HOLD_JUMP, HOLD_JUMP_REPEAT_MS } from './hold-ramp';
import { toPanelSpace, useTapAndHold } from './tap-and-hold';

/**
 * A seat's swipe-up (into commander-damage focus) must mean "away from the
 * player" at every rotation. The check used to read screen-vertical motion
 * and only invert it for 180°, so on a sideways seat (4p-sides, 2p-side,
 * 3p-wide-top-sides) the natural motion was ignored and a screen-vertical one,
 * sideways for that player, fired instead.
 */
describe('toPanelSpace', () => {
  // Screen motion AWAY from the player sitting at each seat's edge.
  const away: Record<number, [number, number]> = {
    0: [0, -60], // upright: player at the bottom, away is up
    90: [60, 0], // left long edge: away is to the right
    180: [0, 60], // far short edge: away is down
    270: [-60, 0], // right long edge: away is to the left
  };

  for (const [rot, [dx, dy]] of Object.entries(away)) {
    it(`${rot}°: motion away from the player is panel-up`, () => {
      const [lx, ly] = toPanelSpace(dx, dy, Number(rot));
      expect(ly).toBe(-60);
      expect(lx).toBeCloseTo(0);
    });
  }

  it('a sideways seat does not read screen-vertical motion as up or down', () => {
    const [lx, ly] = toPanelSpace(0, -60, 90);
    expect(Math.abs(lx)).toBe(60);
    expect(ly).toBeCloseTo(0);
  });
});

/**
 * Lotus's long tap: life jumps ±10 at once, then again while held. Counters
 * keep the gentle ramp, because a held poison counter that jumped by ten
 * would kill someone in one press.
 */
describe('useTapAndHold holdStep', () => {
  function press(holdStep?: number) {
    const ticks: number[] = [];
    const { result } = renderHook(() =>
      useTapAndHold({
        onTap: () => {},
        onHoldTick: (d) => ticks.push(d),
        holdStep,
        disabled: false,
      })
    );
    const h = result.current(-1) as unknown as Record<string, (e: unknown) => void>;
    const target = { setPointerCapture() {}, releasePointerCapture() {} };
    h.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1, currentTarget: target });
    return { ticks, release: () => h.onPointerUp({ pointerId: 1, currentTarget: target }) };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('jumps the full step after the dwell, then repeats it every HOLD_JUMP_REPEAT_MS', () => {
    const { ticks, release } = press(HOLD_JUMP);
    vi.advanceTimersByTime(HOLD_DWELL_MS);
    expect(ticks).toEqual([-10]);
    vi.advanceTimersByTime(HOLD_JUMP_REPEAT_MS * 2);
    expect(ticks).toEqual([-10, -10, -10]);
    release();
    vi.advanceTimersByTime(HOLD_JUMP_REPEAT_MS * 3);
    expect(ticks).toHaveLength(3);
  });

  it('without a holdStep, starts at 1 and ramps, the way counters need', () => {
    const { ticks, release } = press();
    vi.advanceTimersByTime(HOLD_DWELL_MS + 500);
    expect(ticks.every((d) => d === -1)).toBe(true);
    expect(ticks.length).toBeGreaterThan(1);
    release();
  });
});
