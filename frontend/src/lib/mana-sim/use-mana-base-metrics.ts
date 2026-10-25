import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { manaBaseMetricsAsync, metricsKey, peekManaBaseMetrics } from './mana-base-metrics';
import type { ManaBaseMetrics } from './mana-base-metrics';

export interface ManaBaseMetricsState {
  metrics: ManaBaseMetrics | null;
  /** True from the first render with a deck to measure until the run lands, so the panel can reserve its space. */
  pending: boolean;
}

const IDLE: ManaBaseMetricsState = { metrics: null, pending: false };

/**
 * The mana-base metrics for a deck, after paint and shared with every other
 * ask for the same deck (see `./mana-base-metrics.ts`). Pass memoized arrays.
 */
export function useManaBaseMetrics(
  commanders: readonly ScryfallCard[],
  library: readonly ScryfallCard[],
  budget: number
): ManaBaseMetricsState {
  const active = library.length > 0;
  const key = useMemo(
    () => (active ? metricsKey(commanders, library, budget) : null),
    [active, commanders, library, budget]
  );
  const [done, setDone] = useState<{ key: string; metrics: ManaBaseMetrics | null } | null>(null);

  useEffect(() => {
    if (!key || peekManaBaseMetrics(key) !== undefined) return;
    let live = true;
    void manaBaseMetricsAsync(commanders, library, budget).then((metrics) => {
      if (live) setDone({ key, metrics });
    });
    return () => {
      live = false;
    };
  }, [key, commanders, library, budget]);

  if (!key) return IDLE;
  const known = peekManaBaseMetrics(key);
  if (known !== undefined) return { metrics: known, pending: false };
  return done?.key === key
    ? { metrics: done.metrics, pending: false }
    : { metrics: null, pending: true };
}
