import { useEffect, useMemo, useState } from 'react';
import { assemblyClockAsync, clockKey, peekAssemblyClock } from './clock';
import type { AssemblyClockOptions, AssemblyClockResult, ClockCard } from './opening-hand-sim';

type Path = ReadonlyArray<{ names: readonly string[]; need: number }>;

/**
 * The assembly clock for a deck's win path, computed after paint and shared
 * with every other screen asking for the same clock (see `./clock.ts`). `clock`
 * is null until it is known, and stays null when there is no path or library
 * (`path` null), so a caller that hides the line on null needs nothing more.
 */
export function useAssemblyClock(
  library: readonly ClockCard[] | null | undefined,
  path: Path | null | undefined,
  opts: AssemblyClockOptions = {}
): AssemblyClockResult | null {
  const active = !!library?.length && !!path?.length;
  const wildcards = opts.wildcards?.join(',');
  const key = useMemo(
    () => (active ? clockKey(library, path, opts) : null),
    // opts is read by value through its fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, library, path, opts.iterations, opts.seed, wildcards]
  );
  const [done, setDone] = useState<{ key: string; clock: AssemblyClockResult | null } | null>(null);

  useEffect(() => {
    if (!key || !library || !path || peekAssemblyClock(key) !== undefined) return;
    let live = true;
    void assemblyClockAsync(library, path, opts).then((clock) => {
      if (live) setDone({ key, clock });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return null;
  const known = peekAssemblyClock(key);
  if (known !== undefined) return known;
  return done?.key === key ? done.clock : null;
}
