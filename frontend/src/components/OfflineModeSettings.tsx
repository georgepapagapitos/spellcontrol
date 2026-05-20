import { useEffect } from 'react';
import { useOfflineStore } from '@/store/offline';

/**
 * Read-only status for the always-on local card data, plus an escape-hatch
 * "Clear" button. The download itself runs silently in the background after
 * sign-in (see `lib/offline/auto-sync.ts`); there is no toggle and no
 * "Download now" — the user shouldn't have to think about this.
 */
export function OfflineModeSettings(): React.ReactElement {
  const manifest = useOfflineStore((s) => s.manifest);
  const stats = useOfflineStore((s) => s.stats);
  const bootstrapped = useOfflineStore((s) => s.bootstrapped);
  const bootstrap = useOfflineStore((s) => s.bootstrap);
  const clear = useOfflineStore((s) => s.clear);

  useEffect(() => {
    if (!bootstrapped) void bootstrap();
  }, [bootstrap, bootstrapped]);

  const hasData = !!manifest && manifest.oracleCardCount > 0;
  const cardCount = stats?.cardCount ?? manifest?.oracleCardCount ?? 0;
  const sizeBytes = manifest ? manifest.oracleByteSize + manifest.combosByteSize : 0;

  return (
    <section className="settings-card" aria-labelledby="settings-offline-title">
      <header className="settings-card-header">
        <h2 id="settings-offline-title" className="settings-card-title">
          Card data
        </h2>
        <p className="settings-card-hint">
          A local copy of the Scryfall card catalog and combo dataset is kept on this device so
          searches, deck generation, and combo matching work without a network round-trip. It
          refreshes silently in the background — there's nothing to configure.
        </p>
      </header>
      <div className="settings-card-body">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Status</div>
            <div className="settings-row-value">
              {hasData
                ? `${formatNumber(cardCount)} cards · ${formatBytes(sizeBytes)} · updated ${formatRelative(manifest!.oracleUpdatedAt)}`
                : 'Downloading… searches will use the live API until this finishes.'}
            </div>
          </div>
          {hasData && (
            <div className="settings-row-actions">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => void clear()}
                title="Wipe the local card catalog. It will re-download on next sign-in."
              >
                Clear cached card data
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function formatBytes(b: number): string {
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b > 1000) return `${(b / 1000).toFixed(0)} KB`;
  return `${b} B`;
}

/**
 * "2 days ago" / "just now" style — matches the casual tone of the rest of
 * the settings page. Falls back to a locale date for stale data.
 */
function formatRelative(ms: number): string {
  if (!ms) return 'never';
  const deltaSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (deltaSec < 60) return 'just now';
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin} minute${deltaMin === 1 ? '' : 's'} ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr} hour${deltaHr === 1 ? '' : 's'} ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  if (deltaDay < 30) return `${deltaDay} day${deltaDay === 1 ? '' : 's'} ago`;
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return 'a while ago';
  }
}
