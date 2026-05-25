import { logger } from '@/lib/logger';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Browser } from '@capacitor/browser';
import { useAuth } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { THEMES } from '../lib/themes';
import { toast } from '../store/toasts';
import { buildBackup, downloadBackup } from '../lib/backup';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import {
  fetchBackups,
  fetchIdentities,
  fetchSync,
  googleLinkUrl,
  requestGoogleLinkIntent,
  restoreBackup,
  unlinkGoogle,
  type MyIdentities,
  type SyncBackupMeta,
} from '../lib/auth-api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { isNativePlatform } from '../lib/platform';
import { OfflineModeSettings } from '../components/OfflineModeSettings';
import { SharedLinksSettings } from '../components/SharedLinksSettings';
import { resetAppCacheAndReload } from '../lib/reset-app-cache';
import { AdminPanel } from '../components/AdminPanel';
import { usePwaStore } from '../store/pwa';

export function SettingsPage() {
  const username = useAuth((s) => s.user?.username ?? null);
  const userId = useAuth((s) => s.user?.id ?? null);
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const logout = useAuth((s) => s.logout);
  const deleteAccount = useAuth((s) => s.deleteAccount);
  const navigate = useNavigate();

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
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [resetCacheBusy, setResetCacheBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);

  const updateAvailable = usePwaStore((s) => s.updateAvailable);
  const applyPendingUpdate = usePwaStore((s) => s.applyPendingUpdate);

  const [backups, setBackups] = useState<SyncBackupMeta[]>([]);
  const [restorePending, setRestorePending] = useState<SyncBackupMeta | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  // Sign-in methods state — what's linked, plus the in-flight states for the
  // link-Google and unlink-Google flows.
  const [identities, setIdentities] = useState<MyIdentities | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Fetch the user's linked sign-in methods once they're authed. Best-effort:
  // a failure leaves `identities` null, which hides the section (the Settings
  // page must never block on this).
  useEffect(() => {
    // Logout navigates away from Settings, so a null username just unmounts —
    // no need to reset state here. Only fetch when there's an authed user.
    if (!username) return;
    let cancelled = false;
    fetchIdentities()
      .then((r) => {
        if (!cancelled) setIdentities(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Toast on link-Google callback (web: arrives via redirect, native: via
  // the deep-link handler navigating us here with the same query params)
  // and clear the query string so a refresh doesn't re-fire the toast.
  useEffect(() => {
    const linked = searchParams.get('linked');
    const linkError = searchParams.get('linkError');
    if (!linked && !linkError) return;
    if (linked === 'google') {
      toast.show({ message: 'Google account linked.', tone: 'success' });
      void fetchIdentities()
        .then(setIdentities)
        .catch(() => {});
    } else if (linkError) {
      const msg =
        linkError === 'already_linked'
          ? 'That Google account is already linked to a different SpellControl account.'
          : linkError === 'has_google'
            ? 'This account already has a Google account linked. Unlink it first.'
            : 'Could not link Google account.';
      toast.show({ message: msg, tone: 'error' });
    }
    setSearchParams(
      (p) => {
        p.delete('linked');
        p.delete('linkError');
        return p;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  // Native: clear the linking "busy" state when the system browser closes for
  // any reason (success, our close, or user cancel). No-op on web.
  useEffect(() => {
    if (!isNativePlatform()) return;
    const handle = Browser.addListener('browserFinished', () => setLinkBusy(false));
    return () => {
      void handle.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  async function handleLinkGoogle() {
    setLinkBusy(true);
    if (isNativePlatform()) {
      try {
        const intent = await requestGoogleLinkIntent();
        await Browser.open({ url: googleLinkUrl('native', intent) });
      } catch (err) {
        toast.show({
          message: err instanceof Error ? err.message : 'Could not start linking.',
          tone: 'error',
        });
        setLinkBusy(false);
      }
      // Stays busy until the system browser closes (browserFinished listener).
    } else {
      window.location.href = googleLinkUrl('web');
    }
  }

  async function handleUnlinkGoogle() {
    setUnlinkBusy(true);
    try {
      await unlinkGoogle();
      const next = await fetchIdentities();
      setIdentities(next);
      toast.show({ message: 'Google account unlinked.', tone: 'success' });
      setUnlinkOpen(false);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Could not unlink Google.',
        tone: 'error',
      });
    } finally {
      setUnlinkBusy(false);
    }
  }

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
    // Send the now-guest user to the sign-in screen. It's dismissable
    // ("Continue without an account"), so this is a convenience, not a wall.
    navigate('/auth');
  }

  async function handleConfirmDelete() {
    setDeleteBusy(true);
    try {
      const ok = await deleteAccount();
      if (ok) {
        // Account and local data are gone; drop the (now-guest) user on the
        // sign-in screen so they can start fresh. A toast would unmount with
        // the page, so the navigation is the feedback.
        setDeleteStep(0);
        navigate('/auth');
      } else {
        toast.show({
          message: useAuth.getState().error ?? 'Could not delete account.',
          tone: 'error',
        });
        setDeleteStep(0);
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleApplyUpdate() {
    setUpdateBusy(true);
    try {
      await applyPendingUpdate();
      // applyPendingUpdate reloads the tab; nothing below runs in practice.
    } catch (err) {
      logger.warn('[settings] apply update failed:', err);
      toast.show({
        message: 'Could not apply the update. Try reloading the page.',
        tone: 'error',
      });
      setUpdateBusy(false);
    }
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
      logger.warn('[settings] reset app cache failed:', err);
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
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Not signed in</div>
                <div className="settings-row-hint">
                  Your collection, binders, and decks are saved on this device. Sign in to sync them
                  across devices and back them up.
                </div>
              </div>
              <Link to="/auth" className="pill-btn pill-btn-primary">
                Sign in to sync
              </Link>
            </div>
          )}
        </div>
      </section>

      {username && identities && (
        <section className="settings-card" aria-labelledby="settings-signin-title">
          <header className="settings-card-header">
            <h2 id="settings-signin-title" className="settings-card-title">
              Sign-in methods
            </h2>
            <p className="settings-card-hint">
              Add another way to sign in, or remove one. You always need at least one — the account
              can&apos;t end up with no way to sign in.
            </p>
          </header>
          <div className="settings-card-body">
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Password</div>
                <div className="settings-row-hint">{identities.password ? 'Set' : 'Not set'}</div>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Google</div>
                <div className="settings-row-hint">
                  {identities.google ? 'Linked' : 'Not linked'}
                </div>
              </div>
              {identities.google ? (
                <button
                  type="button"
                  className="pill-btn pill-btn-danger"
                  onClick={() => setUnlinkOpen(true)}
                >
                  Unlink
                </button>
              ) : (
                <button
                  type="button"
                  className="pill-btn"
                  onClick={() => void handleLinkGoogle()}
                  disabled={linkBusy}
                >
                  {linkBusy ? 'Opening Google…' : 'Link Google account'}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {unlinkOpen && (
        <ConfirmDialog
          title="Unlink Google?"
          body="You can re-link any time. Your account and data stay intact — only the Google sign-in shortcut is removed."
          confirmLabel={unlinkBusy ? 'Unlinking…' : 'Unlink'}
          danger
          onConfirm={() => void handleUnlinkGoogle()}
          onCancel={() => setUnlinkOpen(false)}
        />
      )}

      {isAdmin && userId && <AdminPanel currentUserId={userId} />}

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

      <SharedLinksSettings />

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
          {updateAvailable && (
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-value">Update available</div>
                <div className="settings-row-hint">
                  A newer version is ready. Updates apply automatically when no game is active —
                  apply now to reload immediately.
                </div>
              </div>
              <button
                type="button"
                className="pill-btn"
                onClick={() => void handleApplyUpdate()}
                disabled={updateBusy}
              >
                {updateBusy ? 'Updating…' : 'Update now'}
              </button>
            </div>
          )}

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

          {username && (
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-value">Delete account</div>
                <div className="settings-row-hint">
                  Permanently deletes your account and all server-side data — collection, binders,
                  decks, games, backups, and share links. This cannot be undone.
                </div>
              </div>
              <button
                type="button"
                className="pill-btn pill-btn-danger"
                onClick={() => setDeleteStep(1)}
              >
                Delete account
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="settings-card" aria-labelledby="settings-about-title">
        <header className="settings-card-header">
          <h2 id="settings-about-title" className="settings-card-title">
            About
          </h2>
          <p className="settings-card-hint">Legal &amp; attribution.</p>
        </header>
        <div className="settings-card-body">
          <p className="settings-row-hint">
            SpellControl is unofficial Fan Content permitted under the{' '}
            <a
              href="https://company.wizards.com/en/legal/fancontentpolicy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Fan Content Policy
            </a>
            . Not approved/endorsed by Wizards. Portions of the materials used are property of
            Wizards of the Coast. ©Wizards of the Coast LLC.
          </p>
          <p className="settings-row-hint">
            Card data and images are provided by{' '}
            <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
              Scryfall
            </a>
            . SpellControl is not affiliated with Scryfall, ManaBox, Moxfield, Archidekt, Deckbox,
            TCGplayer, or Cardsphere.
          </p>
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
      {deleteStep === 1 && (
        <DeleteAccountDialog
          username={username ?? ''}
          step={1}
          busy={deleteBusy}
          onAdvance={() => setDeleteStep(2)}
          onCancel={() => setDeleteStep(0)}
        />
      )}
      {deleteStep === 2 && (
        <DeleteAccountDialog
          username={username ?? ''}
          step={2}
          busy={deleteBusy}
          onAdvance={() => void handleConfirmDelete()}
          onCancel={() => setDeleteStep(0)}
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

interface DeleteAccountDialogProps {
  username: string;
  step: 1 | 2;
  busy: boolean;
  onAdvance: () => void;
  onCancel: () => void;
}

/**
 * Two-step confirmation for permanent account deletion. Step 1 spells out the
 * scope (every server-side record); step 2 is the final irreversible gate.
 * Mirrors WipeConfirmDialog so the destructive-action UX is consistent.
 */
function DeleteAccountDialog({
  username,
  step,
  busy,
  onAdvance,
  onCancel,
}: DeleteAccountDialogProps) {
  useLockBodyScroll();
  const isFinal = step === 2;
  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel} role="presentation">
      <div
        className="choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-account-title" className="choice-dialog-title">
          {isFinal ? 'Last chance — delete your account?' : 'Delete your account?'}
        </h2>
        <p className="choice-dialog-body">
          {isFinal ? (
            <>
              This permanently deletes <strong>{username}</strong> and erases every server-side
              record — collection, binders, decks, games, backups, and share links. There is no
              undo.
            </>
          ) : (
            <>
              This permanently deletes the account <strong>{username}</strong> and all of its data
              from the server. Export a backup first (Data → Export full collection) if you want to
              keep your collection.
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
            {busy ? 'Deleting…' : isFinal ? 'Delete account' : 'Continue'}
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
