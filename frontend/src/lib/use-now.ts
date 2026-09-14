import { useEffect, useState } from 'react';

/**
 * Wall-clock `now`, re-read once a second while `active`.
 *
 * Aligned to the next whole second rather than a flat 1000ms interval from
 * mount: every consumer renders a value that only changes on a second
 * boundary, so an unaligned timer makes the digits appear to lag by up to a
 * second and drift against every other clock on screen.
 *
 * This exists because `Date.now()` cannot be called during render — it is
 * impure, and React Compiler rejects it (`react-hooks/purity`). Reading the
 * clock through state is the fix, not a workaround: a component whose output
 * depends on the time has to re-render when the time changes.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      timer = setTimeout(tick, 1000 - (t % 1000));
    };
    timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => clearTimeout(timer);
  }, [active]);
  return now;
}
