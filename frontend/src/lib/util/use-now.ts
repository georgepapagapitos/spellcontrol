import { useEffect, useState } from 'react';

const msToNextWallSecond = (t: number) => 1000 - (t % 1000);

/**
 * Wall-clock `now`, re-read while `active` at the moment the rendered value
 * next changes.
 *
 * `msToNextChange(t)` says how long until the reading this component shows
 * turns over, measured from the real time `t`. It defaults to the next whole
 * wall-clock second, which is right only for a reading of the time of day.
 * An elapsed-time reading turns over on ITS OWN second, counted from an
 * arbitrary start (see `msToNextSecond` in game-clock): ticking on the wall's
 * seconds instead left the digits up to a second behind, and a pause then
 * landed on a stale digit that ticked once more after the tap.
 *
 * This exists because `Date.now()` cannot be called during render — it is
 * impure, and React Compiler rejects it (`react-hooks/purity`). Reading the
 * clock through state is the fix, not a workaround: a component whose output
 * depends on the time has to re-render when the time changes.
 */
export function useNow(
  active: boolean,
  msToNextChange: (t: number) => number = msToNextWallSecond
): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // From the real time, not the rendered `now`: on resume that is stale by
    // the whole pause, and the next change is due sooner than it implies.
    const timer = setTimeout(() => setNow(Date.now()), msToNextChange(Date.now()));
    return () => clearTimeout(timer);
  }, [active, now, msToNextChange]);
  return now;
}
