import { useEffect, useState } from 'react';
import { useCollectionStore } from '../../store/collection';
import { useBinderLayoutInputs } from '@/lib/binder/use-binder-layout-inputs';
import { materializeBinders } from '@/lib/binder/materialize';
import { aggregateBinderReviewCount } from '@/lib/home/home-signals';

export interface BinderReview {
  /** Cards waiting to be filed across every binder. */
  count: number;
  binderCount: number;
}

/**
 * Home's binder-review count, for Waiting on you. `null` while it is still
 * being computed (or the collection is hydrating); a count of 0 with no
 * binders means there is nothing to review.
 *
 * The materialize + drift pass is the same O(cards × binders) rule-matching
 * engine (with an inner sticky-price-retention loop per card)
 * BindersIndexPage runs — fine on an explicit visit to /collection/binders,
 * not fine to run synchronously on Home's mount now that Home is the default
 * landing route. So the real computation is deferred to a
 * requestIdleCallback (setTimeout(0) fallback) fired from an effect — first
 * paint never waits on it.
 */
export function useBinderReviewCount(): BinderReview | null {
  // BinderPage's inputs: this count used to decorate with tags only, so a
  // Secret Lair or release-date binder could read a different number here
  // than its own "N to file" chip.
  const { cards, binders, allocatedCopyIds, setMap } = useBinderLayoutInputs();
  const hydrating = useCollectionStore((s) => s.hydrating);
  const importHistory = useCollectionStore((s) => s.importHistory);

  const [result, setResult] = useState<BinderReview | null>(null);

  useEffect(() => {
    if (binders.length === 0) return;
    const compute = () => {
      const materialized = materializeBinders(cards, binders, {
        search: '',
        allocatedCopyIds,
        setMap,
      }).binders;
      setResult({
        count: aggregateBinderReviewCount(materialized, cards, importHistory),
        binderCount: binders.length,
      });
    };

    // requestIdleCallback when available, otherwise a setTimeout(0) macrotask
    // — either way runs after first paint (mirrors CardPreview.tsx's preload).
    const ric = (window as unknown as { requestIdleCallback?: typeof requestIdleCallback })
      .requestIdleCallback;
    if (typeof ric === 'function') {
      const handle = ric(compute);
      return () =>
        (
          window as unknown as { cancelIdleCallback?: typeof cancelIdleCallback }
        ).cancelIdleCallback?.(handle);
    }
    const t = window.setTimeout(compute, 0);
    return () => window.clearTimeout(t);
  }, [cards, binders, importHistory, allocatedCopyIds, setMap]);

  if (hydrating) return null;
  if (binders.length === 0) return { count: 0, binderCount: 0 };
  return result;
}
