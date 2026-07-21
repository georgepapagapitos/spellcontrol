import './BinderReviewCard.css';
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useCollectionStore } from '../../store/collection';
import { useAllocations } from '../../lib/allocations';
import { useSetMap } from '../../lib/api';
import { useCardsWithTags, bindersUseTags } from '../../lib/card-tags';
import { materializeBinders } from '../../lib/materialize';
import { aggregateBinderReviewCount } from '../../lib/home-signals';
import { HomeCard } from './HomeCard';

interface ReviewResult {
  count: number;
  binderCount: number;
}

/**
 * Home's binder-review-queue count.
 *
 * Correctness-lens fix (folded into this PR, not a follow-up): the
 * materialize + drift pass below is the same O(cards × binders) rule-matching
 * engine (with an inner sticky-price-retention loop per card) BindersIndexPage
 * already runs — fine when it only ran on an explicit visit to
 * /collection/binders, not fine to run unconditionally on Home's mount once
 * Home becomes the default landing route. So this card paints HomeCard's
 * skeleton immediately and defers the real computation to a
 * requestIdleCallback (setTimeout(0) fallback) fired from an effect — first
 * paint never waits on it.
 */
export function BinderReviewCard() {
  const rawCards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const importHistory = useCollectionStore((s) => s.importHistory);
  // Decorate with Scryfall oracle tags (no-op unless a binder uses a tag
  // rule) — same prep BindersIndexPage runs, so a tag-ruled binder's count
  // agrees between the two surfaces.
  const cards = useCardsWithTags(rawCards, bindersUseTags(binders));
  const allocations = useAllocations();
  const allocatedCopyIds = useMemo(() => new Set(allocations.keys()), [allocations]);
  const setMap = useSetMap();

  const [result, setResult] = useState<ReviewResult | null>(null);

  useEffect(() => {
    if (binders.length === 0) return;
    // No synchronous reset to null here (react-hooks/set-state-in-effect):
    // a stale prior count stays on screen until the deferred recompute below
    // resolves, same as ValueTrend.tsx's own effect never blanks `data`
    // first. Only the very first mount (result starts null) shows a skeleton.
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

  if (binders.length === 0) {
    return (
      <HomeCard
        title="Binder review"
        icon={ClipboardList}
        loading={false}
        empty
        emptyText="No binders set up yet."
        viewAllHref="/collection/binders"
        viewAllLabel="Set one up"
      >
        {null}
      </HomeCard>
    );
  }

  // ponytail: two independent idle-deferred passes, no shared cache between
  // Home and BindersIndexPage; add a memoized selector if profiling ever
  // shows this pair of mounts is hot.
  //
  // No CTA while loading (the count could still resolve to zero) or once
  // resolved to zero (nothing to do) — only a real pending count earns the
  // "View all" link.
  return (
    <HomeCard
      title="Binder review"
      icon={ClipboardList}
      loading={result === null}
      empty={result !== null && result.count === 0}
      emptyText="Binders are all caught up."
      viewAllHref={result && result.count > 0 ? '/collection/binders' : undefined}
    >
      {result && result.count > 0 && (
        <p className="home-binder-review-headline">
          <span
            className="home-binder-review-number"
            role="img"
            aria-label={`${result.count} card${result.count === 1 ? '' : 's'} to review across ${result.binderCount} binder${result.binderCount === 1 ? '' : 's'}`}
          >
            {result.count}
          </span>
          <span aria-hidden="true">
            {' '}
            card{result.count === 1 ? '' : 's'} to review across {result.binderCount} binder
            {result.binderCount === 1 ? '' : 's'}
          </span>
        </p>
      )}
    </HomeCard>
  );
}
