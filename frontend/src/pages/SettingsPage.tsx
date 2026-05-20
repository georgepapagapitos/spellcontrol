import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { THEMES } from '../lib/themes';
import { toast } from '../store/toasts';
import { buildBackup, downloadBackup } from '../lib/backup';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { fetchBackups, fetchSync, restoreBackup, type SyncBackupMeta } from '../lib/auth-api';
import { OfflineModeSettings } from '../components/OfflineModeSettings';
import { resetAppCacheAndReload } from '../lib/reset-app-cache';

export function SettingsPage() {
  const username = useAuth((s) => s.user?.username ?? null);
  const logout = useAuth((s) => s.logout);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const cards = useCollectionStore((s) => s.cards);
  const cardCount = cards.length;
  const isRefreshingPrices = useCollectionStore((s) => s.isRefreshingPrices);
  const refreshPrices = useCollectionStore((s) => s.refreshPrices);
  const buildBackupSnapshot = useCollectionStore((s) => s.buildBackupSnapshot);

  const decks = useDecksStore((s) => s.decks);
  const deckCount = decks.length;
  const remapAllocations = useDecksStore((s) => s.remapAllocations);
  const clearCards = useCollectionStore((s) => s.clearCards);

  const [wipeStep, setWipeStep] = useState<0 | 1 | 2>(0);
  const [wipeBusy, setWipeBusy] = useState(false);
  const [resetCacheBusy, setResetCacheBusy] = useState(false);

  const [backups, setBackups] = useState<SyncBackupMeta[]>([]);
  const [restorePending, setRestorePending] = useState<SyncBackupMeta | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    fetchBackups()
      .then((list) => {
        if (!cancelled) setBackups(list);
      })
      .catch(() => {
        // Best-effort: a backup-list failure must never block Settings.
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  async function handleConfirmRestore() {
    if (!restorePending) return;
    setRestoreBusy(true);
    try {
      // Re-base on the live server version so the restore doesn't 409 against
      // a stale local base; the server still enforces concurrency.
      const current = await fetchSync();
      await restoreBackup({ backupId: restorePending.id, baseVersion: current.version });
      toast.show({
        message: 'Collection restored. Reloading…',
        tone: 'success',
      });
      // The server now holds the restored snapshot at a new version. A reload
      // lets the normal sync boot pull and apply it, avoiding any write-through
      // cache race with the just-restored server state.
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      const status = (err as { status?: number }).status;
      toast.show({
        message:
          status === 409
            ? 'Your data changed on another device. Reload and try again.'
            : err instanceof Error
              ? err.message
              : 'Could not restore backup.',
        tone: 'error',
      });
      setRestoreBusy(false);
      setRestorePending(null);
    }
  }

  async function handleConfirmWipe() {
    setWipeBusy(true);
    try {
      await clearCards();
      toast.show({ message: 'Collection cleared.', tone: 'success' });
      setWipeStep(0);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Could not clear collection.',
        tone: 'error',
      });
    } finally {
      setWipeBusy(false);
    }
  }

  async function handleRefreshPrices() {
    if (isRefreshingPrices || cardCount === 0) return;
    try {
      await refreshPrices();
      toast.show({ message: 'Prices refreshed.', tone: 'success' });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Could not refresh prices.',
        tone: 'error',
      });
    }
  }

  function handleRepairAllocations() {
    if (cardCount === 0 || deckCount === 0) return;
    remapAllocations(cards);
    toast.show({ message: 'Deck allocations repaired.', tone: 'success' });
  }

  function handleExportFull() {
    const snapshot = buildBackupSnapshot();
    downloadBackup(buildBackup(snapshot.collection, snapshot.binders));
    toast.show({ message: 'Backup downloaded.', tone: 'success' });
  }

  async function handleLogout() {
    await logout();
  }

  async function handleResetAppCache() {
    const ok = window.confirm(
      'Reset the cached app version and reload? Your decks, collection, and binders are kept.'
    );
    if (!ok) return;
    setResetCacheBusy(true);
    try {
      await resetAppCacheAndReload();
      // resetAppCacheAndReload triggers location.reload(); nothing below runs.
    } catch (err) {
      console.warn('[settings] reset app cache failed:', err);
      toast.show({
        message: 'Failed to reset the app cache. Try clearing site data from your browser.',
        tone: 'error',
      });
      setResetCacheBusy(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="binder-hero settings-page-hero">
        <div className="settings-page-hero-text">
          <h1 className="binder-hero-name">Settings</h1>
          <p className="binder-hero-meta">Account, appearance, and data tools.</p>
        </div>
      </header>

      <section className="settings-card" aria-labelledby="settings-account-title">
        <header className="settings-card-header">
          <h2 id="settings-account-title" className="settings-card-title">
            Account
          </h2>
        </header>
        <div className="settings-card-body">
          {username ? (
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Signed in as</div>
                <div className="settings-row-value">{username}</div>
              </div>
              <button
                type="button"
                className="pill-btn pill-btn-danger"
                onClick={() => void handleLogout()}
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="settings-row-text">
              <div className="settings-row-label">Not signed in</div>
            </div>
          )}
        </div>
      </section>

      <section className="settings-card" aria-labelledby="settings-appearance-title">
        <header className="settings-card-header">
          <h2 id="settings-appearance-title" className="settings-card-title">
            Appearance
          </h2>
          <p className="settings-card-hint">Theme re-skins the whole app to a guild palette.</p>
        </header>
        <div className="settings-card-body">
          <ul className="settings-theme-grid" role="listbox" aria-label="Choose theme">
            {THEMES.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={t.id === theme}
                  className={`settings-theme-option${t.id === theme ? ' is-active' : ''}`}
                  onClick={() => setTheme(t.id)}
                >
                  <span
                    className="settings-theme-swatch"
                    aria-hidden="true"
                    style={{
                      background: `linear-gradient(135deg, ${t.swatch[0]} 0 50%, ${t.swatch[1]} 50% 100%)`,
                    }}
                  />
                  <span className="settings-theme-name">{t.name}</span>
                  <span className="settings-theme-guild">{t.guild}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <OfflineModeSettings />

      <section className="settings-card" aria-labelledby="settings-data-title">
        <header className="settings-card-header">
          <h2 id="settings-data-title" className="settings-card-title">
            Data
          </h2>
          <p className="settings-card-hint">
            Import, back up, and keep card data fresh. Exports are JSON files you can re-import
            later.
          </p>
        </header>
        <div className="settings-card-body">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-value">Import cards</div>
              <div className="settings-row-hint">
                Add cards from ManaBox, Moxfield, Archidekt, or a CSV. Opens the Collection page.
              </div>
            </div>
            <Link to="/collection" className="pill-btn">
              Open importer
            </Link>
          </div>

          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-value">Export full collection</div>
              <div className="settings-row-hint">
                Download a JSON backup containing every card and binder definition.
              </div>
            </div>
            <button
              type="button"
              className="pill-btn"
              onClick={handleExportFull}
              disabled={cardCount === 0}
            >
              Download backup
            </button>
          </div>

          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-value">Refresh card prices</div>
              <div className="settings-row-hint">
                Re-fetch USD prices from Scryfall for every card in your collection.
              </div>
            </div>
            <button
              type="button"
              className="pill-btn"
              onClick={() => void handleRefreshPrices()}
              disabled={cardCount === 0 || isRefreshingPrices}
            >
              {isRefreshingPrices ? 'Refreshing…' : 'Refresh prices'}
            </button>
          </div>

          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-value">Repair deck allocations</div>
              <div className="settings-row-hint">
                Re-map each deck's reserved copies after edits or re-imports.
              </div>
            </div>
            <button
              type="button"
              className="pill-btn"
              onClick={handleRepairAllocations}
              disabled={cardCount === 0 || deckCount === 0}
            >
              Repair
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="settings-troubleshooting-title">
        <header className="settings-card-header">
          <h2 id="settings-troubleshooting-title" className="settings-card-title">
            Troubleshooting
          </h2>
          <p className="settings-card-hint">
            If the app feels stuck on an old version after an update, reset the cached app shell to
            fetch the latest from the server.
          </p>
        </header>
        <div className="settings-card-body">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-value">Reset app cache</div>
              <div className="settings-row-hint">
                Clears the cached HTML / JS / CSS bundles and unregisters the offline service
                worker, then reloads. Your decks, collection, and binders are not affected.
              </div>
            </div>
            <button
              type="button"
              className="pill-btn"
              onClick={() => void handleResetAppCache()}
              disabled={resetCacheBusy}
            >
              {resetCacheBusy ? 'Resetting…' : 'Reset cache'}
            </button>
          </div>
        </div>
      </section>

      {username && (
        <section className="settings-card" aria-labelledby="settings-backups-title">
          <header className="settings-card-header">
            <h2 id="settings-backups-title" className="settings-card-title">
              Collection backups
            </h2>
            <p className="settings-card-hint">
              If your collection is ever replaced with an empty one, the previous version is saved
              here automatically. Up to the 3 most recent are kept. Restoring overwrites your
              current collection on every device.
            </p>
          </header>
          <div className="settings-card-body">
            {backups.length === 0 ? (
              <div className="settings-row-text">
                <div className="settings-row-hint">
                  No backups yet — one is saved automatically if a collection wipe is detected.
                </div>
              </div>
            ) : (
              backups.map((b) => (
                <div className="settings-row" key={b.id}>
                  <div className="settings-row-text">
                    <div className="settings-row-value">
                      {b.priorCardCount.toLocaleString()}{' '}
                      {b.priorCardCount === 1 ? 'card' : 'cards'}
                    </div>
                    <div className="settings-row-hint">
                      Saved {new Date(b.createdAt).toLocaleString()} · before a collection wipe
                    </div>
                  </div>
                  <button
                    type="button"
                    className="pill-btn"
                    onClick={() => setRestorePending(b)}
                    disabled={restoreBusy}
                  >
                    Restore
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      <section
        className="settings-card settings-card--danger"
        aria-labelledby="settings-danger-title"
      >
        <header className="settings-card-header">
          <h2 id="settings-danger-title" className="settings-card-title">
            Danger zone
          </h2>
          <p className="settings-card-hint">
            Irreversible actions. Make a backup first (Data → Export full collection).
          </p>
        </header>
        <div className="settings-card-body">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-value">Delete entire collection</div>
              <div className="settings-row-hint">
                Removes every card and import-history entry. Binder definitions are kept; they will
                simply have nothing to match against.
              </div>
            </div>
            <button
              type="button"
              className="pill-btn pill-btn-danger"
              onClick={() => setWipeStep(1)}
              disabled={cardCount === 0}
            >
              Delete collection
            </button>
          </div>
        </div>
      </section>

      {wipeStep === 1 && (
        <WipeConfirmDialog
          cardCount={cardCount}
          step={1}
          busy={wipeBusy}
          onAdvance={() => setWipeStep(2)}
          onCancel={() => setWipeStep(0)}
        />
      )}
      {wipeStep === 2 && (
        <WipeConfirmDialog
          cardCount={cardCount}
          step={2}
          busy={wipeBusy}
          onAdvance={() => void handleConfirmWipe()}
          onCancel={() => setWipeStep(0)}
        />
      )}
      {restorePending && (
        <RestoreConfirmDialog
          backup={restorePending}
          busy={restoreBusy}
          onConfirm={() => void handleConfirmRestore()}
          onCancel={() => setRestorePending(null)}
        />
      )}
    </div>
  );
}

interface RestoreConfirmDialogProps {
  backup: SyncBackupMeta;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Single-step confirm: restore is recovery (less dangerous than the wipe)
 * but it still overwrites the current collection on every signed-in device,
 * so the consequence is spelled out before the user commits.
 */
function RestoreConfirmDialog({ backup, busy, onConfirm, onCancel }: RestoreConfirmDialogProps) {
  useLockBodyScroll();
  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel} role="presentation">
      <div
        className="choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-backup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="restore-backup-title" className="choice-dialog-title">
          Restore this backup?
        </h2>
        <p className="choice-dialog-body">
          This replaces your current collection with the{' '}
          <strong>{backup.priorCardCount.toLocaleString()}</strong>{' '}
          {backup.priorCardCount === 1 ? 'card' : 'cards'} saved on{' '}
          {new Date(backup.createdAt).toLocaleString()}. The change syncs to every signed-in device.
          Binders and decks from that backup are restored too.
        </p>
        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface WipeConfirmDialogProps {
  cardCount: number;
  step: 1 | 2;
  busy: boolean;
  onAdvance: () => void;
  onCancel: () => void;
}

/**
 * Two-step confirmation: the first step explains the consequences and
 * requires an intentional "Continue" click; the second is the final
 * "yes, delete" gate. Splitting them stops accidental deletions from
 * muscle memory (one click on a danger button is not enough).
 */
function WipeConfirmDialog({ cardCount, step, busy, onAdvance, onCancel }: WipeConfirmDialogProps) {
  useLockBodyScroll();
  const isFinal = step === 2;
  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel} role="presentation">
      <div
        className="choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wipe-collection-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="wipe-collection-title" className="choice-dialog-title">
          {isFinal ? 'Last chance — delete everything?' : 'Delete entire collection?'}
        </h2>
        <p className="choice-dialog-body">
          {isFinal ? (
            <>
              This will permanently remove <strong>{cardCount.toLocaleString()}</strong>{' '}
              {cardCount === 1 ? 'card' : 'cards'} and the import history. Your binders stay defined
              but will be empty. There is no undo.
            </>
          ) : (
            <>
              You are about to remove all <strong>{cardCount.toLocaleString()}</strong>{' '}
              {cardCount === 1 ? 'card' : 'cards'} from your collection. Binder definitions and
              decks are kept, but decks will lose their physical copy assignments.
            </>
          )}
        </p>
        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={isFinal ? 'btn btn-danger' : 'btn'}
            onClick={onAdvance}
            disabled={busy}
            autoFocus
          >
            {busy ? 'Deleting…' : isFinal ? 'Delete everything' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
