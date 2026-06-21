import { useEffect } from 'react';
import { useOfflineStore } from '@/store/offline';
import { isNativePlatform } from '@/lib/platform';
import type { DownloadPhase } from '@/lib/offline';
import { formatRelativeTime } from '@/lib/format-time';

/**
 * Status for the always-on local card data, plus a manual "Refresh" and an
 * escape-hatch "Clear". The download runs silently in the background after
 * sign-in (see `lib/offline/auto-sync.ts`) and self-heals on a 3h cadence —
 * the Refresh button just makes that immediate when the user knows a server
 * update landed (e.g. a new card-data field) and doesn't want to wait.
 *
 * Native-only — the browser app always reaches the backend directly, so
 * there's no local cache to surface and the section is hidden.
 */

/** User-facing labels for each sync phase, shown in the status line. */
const PHASE_LABELS: Record<DownloadPhase, string> = {
  idle: 'Starting…',
  'fetching-manifest': 'Checking for updates…',
  'waiting-for-server': 'Waiting for the server…',
  'downloading-cards': 'Downloading cards…',
  'storing-cards': 'Saving cards…',
  'downloading-combos': 'Downloading combos…',
  'storing-combos': 'Saving combos…',
  done: 'Up to date',
  error: 'Refresh failed',
};

export function OfflineModeSettings(): React.ReactElement | null {
  const native = isNativePlatform();
  const manifest = useOfflineStore((s) => s.manifest);
  const stats = useOfflineStore((s) => s.stats);
  const progress = useOfflineStore((s) => s.progress);
  const error = useOfflineStore((s) => s.error);
  const bootstrapped = useOfflineStore((s) => s.bootstrapped);
  const bootstrap = useOfflineStore((s) => s.bootstrap);
  const sync = useOfflineStore((s) => s.sync);
  const clear = useOfflineStore((s) => s.clear);

  useEffect(() => {
    if (native && !bootstrapped) void bootstrap();
  }, [native, bootstrap, bootstrapped]);

  if (!native) return null;

  const hasData = !!manifest && manifest.oracleCardCount > 0;
  const cardCount = stats?.cardCount ?? manifest?.oracleCardCount ?? 0;
  const sizeBytes = manifest ? manifest.oracleByteSize + manifest.combosByteSize : 0;
  // A sync is in flight while progress is set to anything but a terminal phase.
  const syncing = progress !== null && progress.phase !== 'done' && progress.phase !== 'error';

  let statusText: string;
  if (syncing) {
    const label = PHASE_LABELS[progress.phase];
    statusText = progress.detail ? `${label} (${progress.detail})` : label;
  } else if (progress?.phase === 'error') {
    statusText = `Refresh failed${error ? `: ${error}` : ''}. Card searches still use the live API.`;
  } else if (hasData) {
    statusText = `${formatNumber(cardCount)} cards · ${formatBytes(sizeBytes)} · updated ${formatRelative(manifest!.oracleUpdatedAt)}`;
  } else {
    statusText = 'Downloading… searches will use the live API until this finishes.';
  }

  return (
    <section className="settings-card" aria-labelledby="settings-offline-title">
      <header className="settings-card-header">
        <h2 id="settings-offline-title" className="settings-card-title">
          Card data
        </h2>
        <p className="settings-card-hint">
          A local copy of the Scryfall card catalog and combo dataset is kept on this device so
          searches, deck generation, and combo matching work without a network round-trip. It
          refreshes automatically in the background; refresh it manually below if you need the
          latest data right away.
        </p>
      </header>
      <div className="settings-card-body">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Status</div>
            <div className="settings-row-value">{statusText}</div>
          </div>
          <div className="settings-row-actions">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => void sync()}
              disabled={syncing}
              title="Check the server for newer card data and download it now."
            >
              {syncing ? 'Refreshing…' : 'Refresh card data now'}
            </button>
            {hasData && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => void clear()}
                disabled={syncing}
                title="Wipe the local card catalog. It will re-download on next sign-in."
              >
                Clear cached card data
              </button>
            )}
          </div>
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

function formatRelative(ms: number): string {
  return formatRelativeTime(ms, { verbose: true, neverLabel: 'never' });
}
