import { useEffect } from 'react';
import { useOfflineStore } from '@/store/offline';
import type { DownloadPhase } from '@/lib/offline';
import { formatBytes } from '@/lib/util/format-bytes';
import { formatRelativeTime } from '@/lib/util/format-time';
import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';

/**
 * Status for the local card data, plus "Refresh" to download or update it and
 * an escape-hatch "Clear".
 *
 * The download is opt-in and never runs on its own: the backend is always one
 * round-trip away, so seeding tens of megabytes into IndexedDB is a cost the
 * user chooses, not one we impose. Once seeded, card and combo reads
 * short-circuit against it.
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
  error: "Couldn't refresh",
};

export function OfflineModeSettings(): React.ReactElement | null {
  const manifest = useOfflineStore((s) => s.manifest);
  const stats = useOfflineStore((s) => s.stats);
  const progress = useOfflineStore((s) => s.progress);
  const error = useOfflineStore((s) => s.error);
  const bootstrapped = useOfflineStore((s) => s.bootstrapped);
  const bootstrap = useOfflineStore((s) => s.bootstrap);
  const sync = useOfflineStore((s) => s.sync);
  const clear = useOfflineStore((s) => s.clear);

  useEffect(() => {
    if (!bootstrapped) void bootstrap();
  }, [bootstrap, bootstrapped]);

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
    statusText = `${hasData ? 'Refresh' : 'Download'} failed${error ? `: ${error}` : ''}. Card searches still use the live API.`;
  } else if (hasData) {
    statusText = `${formatNumber(cardCount)} cards · ${formatBytes(sizeBytes)} · updated ${formatRelative(manifest!.oracleUpdatedAt)}`;
  } else {
    // The download is opt-in: with no data and no sync running, nothing is
    // downloading, so the status must not say it is.
    statusText = 'Not downloaded.';
  }

  return (
    <Surface
      as="section"
      variant="framed"
      className="settings-card"
      aria-labelledby="settings-offline-title"
    >
      <header className="settings-card-header">
        <h2 id="settings-offline-title" className="settings-card-title">
          Card data
        </h2>
        <p className="settings-card-hint">
          Download it to this device and card search and combos work offline.
        </p>
      </header>
      <div className="settings-card-body">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Status</div>
            <div className="settings-row-value">{statusText}</div>
          </div>
          <div className="settings-row-actions">
            <Button onClick={() => void sync()} disabled={syncing}>
              {hasData
                ? syncing
                  ? 'Refreshing…'
                  : 'Refresh card data'
                : syncing
                  ? 'Downloading…'
                  : 'Download card data'}
            </Button>
          </div>
        </div>
        {hasData && (
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-label">Cached card data</div>
              {/* Nothing re-downloads on its own; clearing is final until the
                  user presses Download again. */}
              <div className="settings-row-hint">
                Frees {formatBytes(sizeBytes)} on this device.
              </div>
            </div>
            <div className="settings-row-actions">
              <Button onClick={() => void clear()} disabled={syncing}>
                Clear cached card data
              </Button>
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function formatRelative(ms: number): string {
  return formatRelativeTime(ms, { verbose: true, neverLabel: 'never' });
}
