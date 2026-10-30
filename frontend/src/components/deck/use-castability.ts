import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { analyzeCastabilitySliced, type CastabilityReport } from '@/lib/deck-analysis/castability';

/**
 * The castability report for a deck, computed after the panel paints.
 *
 * 4,000 goldfish games take about 150 ms for a 100-card list (over half a
 * second on a mid-range phone), so they run off the render and in slices that
 * yield the main thread: the stats show at once, taps stay responsive, and
 * this block joins them a moment later. Until then, and for a deck with no spells to measure, it returns
 * null. A result is tagged with the list it was computed for, so an answer
 * for the previous list is never shown for the next one.
 *
 * Pass memoized arrays. The simulation reruns when either array changes,
 * which is also when the cards' mana data is backfilled (use-produced-mana).
 */
export function useCastability(
  commanders: readonly ScryfallCard[],
  library: readonly ScryfallCard[]
): CastabilityReport | null {
  const key = useMemo(
    () => [...commanders, ...library].map((c) => c.name).join('|'),
    [commanders, library]
  );
  const [result, setResult] = useState<{ key: string; report: CastabilityReport } | null>(null);

  useEffect(() => {
    if (library.length === 0) return;
    let cancelled = false;
    const run = () => {
      void analyzeCastabilitySliced(commanders, library, () => cancelled).then((report) => {
        if (report) setResult({ key, report });
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 1500 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [key, commanders, library]);

  return result?.key === key && result.report.measured > 0 ? result.report : null;
}
