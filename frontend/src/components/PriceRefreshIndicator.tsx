import { useCollectionStore } from '../store/collection';

/**
 * Global, platform-agnostic progress pill for a user-initiated price refresh.
 *
 * A large collection pages into many /api/refresh-prices chunks and runs for a
 * while, so this keeps "still working (3/12)…" visible after the user navigates
 * away from Settings. It lives in the app shell (Layout) — NOT the header, which
 * is display:none below 1024px — so it shows identically on desktop, mobile web,
 * and native, and clears the native status bar via --safe-top.
 *
 * Driven by the reactive `priceRefreshProgress` store field, which is only set
 * for tracked (manual) refreshes; the silent boot auto-refresh never flashes it.
 */
export function PriceRefreshIndicator() {
  const progress = useCollectionStore((s) => s.priceRefreshProgress);
  if (!progress) return null;
  const { done, total } = progress;
  // Single-chunk collections need no count — "(1/1)" reads as noise.
  const label = `Refreshing prices${total > 1 ? ` (${done}/${total})` : ''}…`;
  return (
    <div className="price-refresh-indicator" role="status" aria-live="polite">
      <span className="sync-indicator-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}
