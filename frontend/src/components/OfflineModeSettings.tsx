import { useEffect } from 'react';
import { useOfflineStore } from '@/store/offline';

/**
 * Settings panel for offline mode: opt-in toggle, dataset status, manual
 * sync trigger, and clear-data button. Drops into SettingsPage as a sibling
 * of the appearance / data-management sections.
 */
export function OfflineModeSettings(): React.ReactElement {
  const enabled = useOfflineStore((s) => s.enabled);
  const manifest = useOfflineStore((s) => s.manifest);
  const stats = useOfflineStore((s) => s.stats);
  const progress = useOfflineStore((s) => s.progress);
  const error = useOfflineStore((s) => s.error);
  const bootstrapped = useOfflineStore((s) => s.bootstrapped);
  const setEnabled = useOfflineStore((s) => s.setEnabled);
  const bootstrap = useOfflineStore((s) => s.bootstrap);
  const sync = useOfflineStore((s) => s.sync);
  const clear = useOfflineStore((s) => s.clear);

  useEffect(() => {
    if (!bootstrapped) void bootstrap();
  }, [bootstrap, bootstrapped]);

  const hasData = !!manifest && manifest.oracleCardCount > 0;
  const isSyncing =
    !!progress &&
    progress.phase !== 'idle' &&
    progress.phase !== 'done' &&
    progress.phase !== 'error';

  return (
    <section className="settings-card" aria-labelledby="settings-offline-title">
      <header className="settings-card-header">
        <h2 id="settings-offline-title" className="settings-card-title">
          Offline mode
        </h2>
        <p className="settings-card-hint">
          Plan decks, search cards, and analyze combos without a network. A one-time download (~10
          MB) keeps a local copy of the card catalog and combo dataset. EDHREC-driven deck
          generation falls back to local heuristics — quality is reduced, but generation still
          works.
        </p>
      </header>
      <div className="settings-card-body">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Use offline data when available</div>
            <div className="settings-row-value">
              {enabled
                ? hasData
                  ? 'Enabled — searches read from the local catalog.'
                  : 'Enabled, but no data is downloaded yet.'
                : 'Disabled — searches use the live Scryfall API.'}
            </div>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              aria-label="Use offline data when available"
            />
            <span aria-hidden="true">{enabled ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Local dataset</div>
            <div className="settings-row-value">
              {hasData
                ? `${formatNumber(stats?.cardCount ?? manifest!.oracleCardCount)} cards · ${formatNumber(stats?.comboCount ?? manifest!.combosCount)} combos · ${formatBytes(manifest!.oracleByteSize + manifest!.combosByteSize)} on the server`
                : 'No data downloaded yet.'}
            </div>
            {manifest && (
              <div className="settings-row-meta">
                Last updated {formatDate(manifest.oracleUpdatedAt)} · catalog version{' '}
                <code>{manifest.oracleVersion.slice(0, 8)}</code>
              </div>
            )}
          </div>
          <div className="settings-row-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void sync({ force: false })}
              disabled={isSyncing}
            >
              {hasData ? 'Check for updates' : 'Download now'}
            </button>
            {hasData && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => void clear()}
                disabled={isSyncing}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {progress && (
          <div className="settings-row" aria-live="polite">
            <div className="settings-row-text">
              <div className="settings-row-label">{phaseLabel(progress.phase)}</div>
              <div className="settings-row-value">{progress.detail ?? ''}</div>
              {typeof progress.fraction === 'number' && (
                <div
                  className="settings-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.fraction * 100)}
                >
                  <span style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="settings-row settings-row-error" role="alert">
            <div className="settings-row-text">
              <div className="settings-row-label">Sync failed</div>
              <div className="settings-row-value">{error}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'fetching-manifest':
      return 'Checking server…';
    case 'waiting-for-server':
      return 'Server is preparing data…';
    case 'downloading-cards':
      return 'Downloading card catalog…';
    case 'storing-cards':
      return 'Saving cards locally…';
    case 'downloading-combos':
      return 'Downloading combos…';
    case 'storing-combos':
      return 'Saving combos locally…';
    case 'done':
      return 'Up to date.';
    case 'error':
      return 'Sync error';
    default:
      return phase;
  }
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function formatBytes(b: number): string {
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b > 1000) return `${(b / 1000).toFixed(0)} KB`;
  return `${b} B`;
}

function formatDate(ms: number): string {
  if (!ms) return 'never';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return 'unknown';
  }
}
