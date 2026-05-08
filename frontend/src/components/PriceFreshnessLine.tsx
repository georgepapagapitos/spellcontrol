import { useMemo } from 'react';
import { useCollectionStore } from '../store/collection';

/**
 * Tiny status line below the collection table — "Prices · 2h ago ⟳".
 * Always renders when there are cards so users can spot stale numbers and
 * trigger a refresh without an attention-grabbing banner.
 */
export function PriceFreshnessLine() {
  const cards = useCollectionStore((s) => s.cards);
  const isRefreshing = useCollectionStore((s) => s.isRefreshingPrices);
  const refreshPrices = useCollectionStore((s) => s.refreshPrices);

  const mostRecent = useMemo(() => {
    let best = 0;
    for (const c of cards) {
      const t = c.pricedAt;
      if (typeof t === 'number' && t > best) best = t;
    }
    return best;
  }, [cards]);

  if (cards.length === 0) return null;

  return (
    <p className="price-freshness-line" role="status" aria-live="polite">
      <span>Prices · {formatAgo(mostRecent)}</span>
      <button
        type="button"
        className={`price-refresh-icon${isRefreshing ? ' is-busy' : ''}`}
        onClick={() => refreshPrices()}
        disabled={isRefreshing}
        aria-label="Refresh prices"
        title="Refresh prices"
      >
        <RefreshIcon />
      </button>
    </p>
  );
}

function formatAgo(ts: number): string {
  if (!ts) return 'never refreshed';
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M13.5 2.5v3h-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
