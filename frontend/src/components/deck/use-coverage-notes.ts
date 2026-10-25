import { useMemo } from 'react';
import { basisLine, completionCost, heldLine } from '@/lib/deck/commander-readiness';
import { formatMoney } from '@/lib/collection/format-money';
import { useDebouncedValue } from '@/lib/util/use-debounced-value';
import { useCardPriceLookup } from './use-missing-prices';
import type { CoverageNotes } from './CommanderResultCard';
import type { ReadinessMap } from './use-commander-readiness';

/** Distinct missing staples priced at once: 12 tiles of about 40 each, with overlap. */
const PRICE_LOOKUP_CAP = 600;

/**
 * The lines under a coverage bar for the visible tiles: "~$48 to finish" (their
 * missing staples priced in one lookup; the card repository batches and caches,
 * and staples repeat across commanders), what is already in a deck, and the
 * sample behind the numbers. `cost` stays null ("Pricing…") until the lookup
 * for the current set of tiles has landed.
 */
export function useCoverageNotes(
  enabled: boolean,
  visibleNames: readonly string[],
  readiness: ReadinessMap
): (name: string) => CoverageNotes | undefined {
  // A string key keeps the debounce from restarting on every render.
  const missingKey = enabled
    ? [
        ...new Set(
          visibleNames.flatMap((name) => {
            const r = readiness.get(name.toLowerCase());
            return r && r !== 'loading' && r.available ? (r.missingNames ?? []) : [];
          })
        ),
      ].join('\n')
    : '';
  const settledKey = useDebouncedValue(missingKey, 400);
  const settledMissing = useMemo(() => (settledKey ? settledKey.split('\n') : []), [settledKey]);
  const { prices, loaded } = useCardPriceLookup(settledMissing, PRICE_LOOKUP_CAP);

  return (name) => {
    const r = readiness.get(name.toLowerCase());
    if (!enabled || !r || r === 'loading' || !r.available) return undefined;
    const cost = loaded && settledKey === missingKey ? completionCost(r, prices) : null;
    return {
      cost: cost
        ? `${cost.priced > 0 || cost.unpriced === 0 ? '~' : ''}${formatMoney(cost.total, { wholeDollars: true })} to finish${cost.unpriced > 0 ? `, ${cost.unpriced} without a price` : ''}`
        : null,
      held: heldLine(r),
      basis: basisLine(r),
    };
  };
}
