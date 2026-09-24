import { describe, it, expect } from 'vitest';
import { toPanelSpace } from './tap-and-hold';

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
