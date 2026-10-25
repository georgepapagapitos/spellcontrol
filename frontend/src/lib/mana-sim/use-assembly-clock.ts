import { useEffect, useMemo, useState } from 'react';
import { assemblyClockAsync, clockKey, peekAssemblyClock } from './clock';
import type { AssemblyClockOptions, AssemblyClockResult, ClockCard } from './opening-hand-sim';

const IDLE: AssemblyClockState = { clock: null, pending: false };

type Path = ReadonlyArray<{ names: readonly string[]; need: number }>;

/** What a panel needs to draw the clock: the result, and whether one is on its way. */
export interface AssemblyClockState {
  clock: AssemblyClockResult | null;
  pending: boolean;
}

/**
 * The assembly clock for a deck's win path, computed after paint and shared
 * with every other screen asking for the same clock (see `./clock.ts`).
 *
 * `pending` is true from the first render that has a path and a library until
 * the run lands, so a panel can draw a skeleton of the right size and nothing
 * below it moves. Whether there is a clock to wait for (a path, a library) is
 * known on the first render: with none, `pending` is false and `clock` null.
 */
export function useAssemblyClock(
  library: readonly ClockCard[] | null | undefined,
  path: Path | null | undefined,
  opts: AssemblyClockOptions = {}
): AssemblyClockState {
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

  if (!key) return IDLE;
  const known = peekAssemblyClock(key);
  if (known !== undefined) return { clock: known, pending: false };
  return done?.key === key ? { clock: done.clock, pending: false } : { clock: null, pending: true };
}
