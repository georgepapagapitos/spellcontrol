import { useMemo } from 'react';
import { useCollectionStore } from '../store/collection';

const STALE_MS = 7 * 86400_000;

export function PriceFreshnessBanner() {
  const cards = useCollectionStore((s) => s.cards);
  const isRefreshing = useCollectionStore((s) => s.isRefreshingPrices);
  const refreshPrices = useCollectionStore((s) => s.refreshPrices);

  const summary = useMemo(() => {
    if (cards.length === 0) return null;

    const seen = new Set<string>();
    let staleCount = 0;
    let unpricedCount = 0;
    let mostRecent = 0;
    let oldestPriced = Infinity;
    const now = Date.now();

    for (const c of cards) {
      const key = c.scryfallId || `${c.name}:${c.setCode}:${c.collectorNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (c.purchasePrice === 0) {
        unpricedCount += 1;
        continue;
      }

      const t = c.pricedAt;
      if (typeof t !== 'number') {
        staleCount += 1;
        continue;
      }
      if (now - t > STALE_MS) staleCount += 1;
      if (t > mostRecent) mostRecent = t;
      if (t < oldestPriced) oldestPriced = t;
    }

    const needsRefresh = staleCount > 0 || unpricedCount > 0;
    return { staleCount, unpricedCount, mostRecent, oldestPriced, needsRefresh };
  }, [cards]);

  if (!summary || !summary.needsRefresh) return null;

  return (
    <div className="price-freshness-banner" role="status" aria-live="polite">
      <div className="price-freshness-banner-text">{buildMessage(summary)}</div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => refreshPrices()}
        disabled={isRefreshing}
      >
        {isRefreshing ? 'Refreshing prices…' : 'Refresh prices'}
      </button>
    </div>
  );
}

function buildMessage(s: {
  staleCount: number;
  unpricedCount: number;
  mostRecent: number;
}): string {
  const parts: string[] = [];
  if (s.mostRecent > 0) {
    const days = Math.floor((Date.now() - s.mostRecent) / 86400_000);
    if (days <= 0) parts.push('Prices were refreshed today.');
    else if (days === 1) parts.push('Prices were last refreshed 1 day ago.');
    else parts.push(`Prices were last refreshed ${days} days ago.`);
  } else {
    parts.push('Prices have not been refreshed yet.');
  }
  if (s.unpricedCount > 0) {
    parts.push(`${s.unpricedCount} ${s.unpricedCount === 1 ? 'card has' : 'cards have'} no price.`);
  }
  return parts.join(' ');
}
