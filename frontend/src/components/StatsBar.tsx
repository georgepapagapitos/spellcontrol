import { useCollectionStore } from '../store/collection';
import type { MaterializedBinder, UnbinnedBucket } from '../types';

interface Props {
  binders: MaterializedBinder[];
  unbinned: UnbinnedBucket;
}

export function StatsBar({ binders, unbinned }: Props) {
  const { cards, scryfallMisses } = useCollectionStore();

  const totalValue = cards.reduce((sum, c) => sum + c.purchasePrice, 0);

  const binnedCount = binders.reduce((s, b) => s + b.totalCards, 0);
  const unbinnedCount = unbinned.totalCards;
  const denom = binnedCount + unbinnedCount;
  const binnedPct = denom > 0 ? Math.round((binnedCount / denom) * 100) : 0;

  const totalBinderPages =
    binders.reduce((s, b) => s + b.totalPages, 0) + unbinned.totalPages;

  return (
    <>
      <div className="stat-grid">
        <Stat label="Total cards" value={cards.length.toLocaleString()} />
        <Stat
          label="In binders"
          value={binnedCount.toLocaleString()}
          sub={denom > 0 ? `${binnedPct}%` : undefined}
        />
        <Stat
          label="Still in bulk"
          value={unbinnedCount.toLocaleString()}
          sub={denom > 0 ? `${100 - binnedPct}%` : undefined}
        />
        <Stat label="Binder pages" value={totalBinderPages.toString()} />
        <Stat label="Collection value" value={`$${totalValue.toFixed(0)}`} />
      </div>
      {scryfallMisses > 0 && (
        <div className="warn-banner">
          ⚠️ {scryfallMisses} card{scryfallMisses !== 1 ? 's' : ''} could not be enriched
          with Scryfall data — color/CMC/type sorting may be inaccurate for those cards.
        </div>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
