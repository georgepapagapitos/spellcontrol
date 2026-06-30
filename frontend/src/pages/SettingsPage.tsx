import { logger } from '@/lib/logger';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Browser } from '@capacitor/browser';
import { useAuth } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { THEMES } from '../lib/themes';
import { toast } from '../store/toasts';
import { buildBackup, downloadBackup } from '../lib/backup';
import { Modal } from '../components/Modal';
import { formatPricedDate, newestPricedAt } from '../lib/price-freshness';
import {
  fetchIdentities,
  googleLinkUrl,
  requestGoogleLinkIntent,
  unlinkGoogle,
  type MyIdentities,
} from '../lib/auth-api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { InfoTip } from '../components/InfoTip';
import { SyncIndicator } from '../components/SyncIndicator';
import { isNativePlatform } from '../lib/platform';
import { OfflineModeSettings } from '../components/OfflineModeSettings';
import { SharedLinksSettings } from '../components/SharedLinksSettings';
import { resetAppCacheAndReload } from '../lib/reset-app-cache';
import { AdminPanel } from '../components/AdminPanel';
import { getPendingCount } from '../lib/sync';

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
  const pricesUpdated = useMemo(() => formatPricedDate(newestPricedAt(cards)), [cards]);
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
  // Sign-out confirmation. `signOutPending` snapshots the unsynced-change count
  // at the moment the dialog opens so the copy can warn about data loss.
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutPending, setSignOutPending] = useState(0);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [resetCacheOpen, setResetCacheOpen] = useState(false);

  // Sign-in methods state — what's linked, plus the in-flight states for the
  // link-Google and unlink-Google flows.
  const [identities, setIdentities] = useState<MyIdentities | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

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
            : "Couldn't link Google account.";
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
          message: err instanceof Error ? err.message : "Couldn't start linking.",
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
        message: err instanceof Error ? err.message : "Couldn't unlink Google.",
        tone: 'error',
      });
    } finally {
      setUnlinkBusy(false);
    }
  }

  async function handleConfirmWipe() {
    setWipeBusy(true);
    try {
      // clearCards() surfaces its own "Collection cleared" toast (with Undo) and
      // swallows IDB errors internally, so there's nothing to confirm or catch here.
      await clearCards();
      setWipeStep(0);
    } finally {
      setWipeBusy(false);
    }
  }

  async function handleRefreshPrices() {
    if (isRefreshingPrices || cardCount === 0) return;
    try {
      // track: surface the global "Refreshing prices (n/m)…" pill so progress
      // stays visible after the user navigates away from Settings.
      await refreshPrices(undefined, { track: true });
      toast.show({ message: 'Prices refreshed.', tone: 'success' });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't refresh prices.",
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

  function openSignOut() {
    // Snapshot the unsynced-change count now so the dialog copy is accurate.
    setSignOutPending(getPendingCount());
    setSignOutOpen(true);
  }

  async function handleLogout() {
    setSignOutBusy(true);
    try {
      await logout();
      // Send the now-guest user to the sign-in screen. It's dismissable
      // ("Continue without an account"), so this is a convenience, not a wall.
      navigate('/auth');
    } finally {
      setSignOutBusy(false);
      setSignOutOpen(false);
    }
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
          message: useAuth.getState().error ?? "Couldn't delete account.",
          tone: 'error',
        });
        setDeleteStep(0);
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleResetAppCache() {
    setResetCacheOpen(false);
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

      {/* ── 1. Account ─────────────────────────────────────────────────────── */}
      <div role="group" aria-labelledby="settings-account-group-title">
        <h2 id="settings-account-group-title" className="sr-only">
          Account
        </h2>
        <section className="settings-card" aria-labelledby="settings-account-title">
          <header className="settings-card-header">
            <h2 id="settings-account-title" className="settings-card-title">
              Account
            </h2>
          </header>
          <div className="settings-card-body">
            {username ? (
              <>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Signed in as</div>
                    <div className="settings-row-value">{username}</div>
                  </div>
                  <button type="button" className="btn" onClick={openSignOut}>
                    Sign out
                  </button>
                </div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Sync status</div>
                  </div>
                  <SyncIndicator />
                </div>
              </>
            ) : (
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-label">Not signed in</div>
                  <div className="settings-row-hint">
                    Your collection, binders, and decks are saved on this device. Sign in to sync
                    them across devices and back them up. Any cards on this device will be added to
                    your account when you sign in.
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
                Add another way to sign in, or remove one. You always need at least one — the
                account can&apos;t end up with no way to sign in.
              </p>
            </header>
            <div className="settings-card-body">
              {/* Password row: status-only for now; action slot left open for a
                  future Set/Change password flow to slot in. */}
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
                    className="btn btn-danger"
                    onClick={() => setUnlinkOpen(true)}
                  >
                    Unlink
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
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
      </div>

      {/* ── 2. Appearance ──────────────────────────────────────────────────── */}
      <div role="group" aria-labelledby="settings-appearance-group-title">
        <h2 id="settings-appearance-group-title" className="settings-section-header">
          Appearance
        </h2>
        <section className="settings-card" aria-labelledby="settings-appearance-title">
          <header className="settings-card-header">
            <h2 id="settings-appearance-title" className="settings-card-title">
              Theme
            </h2>
            <p className="settings-card-hint">Theme re-skins the whole app to a guild palette.</p>
          </header>
          <div className="settings-card-body">
            <fieldset className="settings-theme-grid" aria-label="Choose theme">
              {THEMES.map((t) => (
                <label
                  key={t.id}
                  className={`settings-theme-option${t.id === theme ? ' is-active' : ''}`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={t.id}
                    checked={t.id === theme}
                    onChange={() => setTheme(t.id)}
                    className="settings-theme-radio"
                  />
                  <span
                    className="settings-theme-swatch"
                    aria-hidden="true"
                    style={{
                      background: `linear-gradient(135deg, ${t.swatch[0]} 0 50%, ${t.swatch[1]} 50% 100%)`,
                    }}
                  />
                  <span className="settings-theme-name">{t.name}</span>
                  <span className="settings-theme-guild">{t.guild}</span>
                </label>
              ))}
            </fieldset>
          </div>
        </section>
      </div>

      {/* ── 3. Collection ──────────────────────────────────────────────────── */}
      <div role="group" aria-labelledby="settings-collection-group-title">
        <h2 id="settings-collection-group-title" className="settings-section-header">
          Collection
        </h2>
        <section className="settings-card" aria-labelledby="settings-collection-title">
          <header className="settings-card-header">
            <h2 id="settings-collection-title" className="settings-card-title">
              Collection
            </h2>
            <p className="settings-card-hint">
              Back up and keep card data fresh. Exports are JSON files you can re-import later.
            </p>
          </header>
          <div className="settings-card-body">
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-value settings-row-value--with-tip">
                  Export full collection
                  <InfoTip
                    label="binders and lists"
                    wide
                    text={
                      <>
                        <strong>Binders</strong> are rule-driven — you define filters (color, set,
                        rarity, etc.) and SpellControl automatically routes matching cards into
                        them.
                        <br />
                        <br />
                        <strong>Lists</strong> are manual — a named group of specific cards you
                        curate by hand, for things like a wish list or trade targets.
                        <br />
                        <br />
                        The backup includes both binder rule definitions and lists.
                      </>
                    }
                  />
                </div>
                <div className="settings-row-hint">
                  Download a JSON backup containing every card and binder definition.
                </div>
              </div>
              <button
                type="button"
                className="btn"
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
                  {pricesUpdated && ` Last updated ${pricesUpdated}.`}
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => void handleRefreshPrices()}
                disabled={cardCount === 0 || isRefreshingPrices}
              >
                {isRefreshingPrices ? 'Refreshing…' : 'Refresh prices'}
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-value settings-row-value--with-tip">
                  Repair deck allocations
                  <InfoTip
                    label="deck allocations"
                    text="An allocation links each card slot in a deck to a specific physical copy in your collection — so if you own two copies of a card, SpellControl knows which one is claimed by which deck. Repair re-runs this matching after edits or re-imports."
                  />
                </div>
                <div className="settings-row-hint">
                  Re-map each deck’s reserved copies after edits or re-imports.
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={handleRepairAllocations}
                disabled={cardCount === 0 || deckCount === 0}
              >
                Repair
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ── 4. Sharing (authed only — SharedLinksSettings self-hides for guests,
              so the whole group is suppressed when there’s no username) ─────── */}
      {username && (
        <div role="group" aria-labelledby="settings-sharing-group-title">
          <h2 id="settings-sharing-group-title" className="settings-section-header">
            Sharing
          </h2>
          <SharedLinksSettings />
        </div>
      )}

      {/* ── 5. Data & Storage ─────────────────────────────────────── */}
      <div role="group" aria-labelledby="settings-data-group-title">
        <h2 id="settings-data-group-title" className="settings-section-header">
          Data &amp; Storage
        </h2>

        <OfflineModeSettings />

        <section className="settings-card" aria-labelledby="settings-troubleshooting-title">
          <header className="settings-card-header">
            <h2 id="settings-troubleshooting-title" className="settings-card-title">
              Troubleshooting
            </h2>
            <p className="settings-card-hint">
              If the app feels stuck on an old version after an update, reset the cached app shell
              to fetch the latest from the server.
            </p>
          </header>
          <div className="settings-card-body">
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-value">Reset app cache</div>
                <div className="settings-row-hint">
                  Clears the cached HTML / JS / CSS bundles, then reloads to fetch the latest from
                  the server. Your decks, collection, and binders are not affected.
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setResetCacheOpen(true)}
                disabled={resetCacheBusy}
              >
                {resetCacheBusy ? 'Resetting…' : 'Reset cache'}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ── 6. Admin (admin users only) ────────────────────────────────── */}
      {isAdmin && userId && (
        <div role="group" aria-labelledby="settings-admin-group-title">
          <h2 id="settings-admin-group-title" className="settings-section-header">
            Admin
          </h2>
          <AdminPanel currentUserId={userId} />
        </div>
      )}

      {/* ── 7. Danger zone ─────────────────────────────────────────────── */}
      <h2 id="settings-danger-group-title" className="settings-section-header">
        Danger zone
      </h2>
      <section
        className="settings-card settings-card--danger"
        aria-labelledby="settings-danger-title"
      >
        <header className="settings-card-header">
          <h2 id="settings-danger-title" className="settings-card-title">
            Danger zone
          </h2>
          <p className="settings-card-hint">
            Irreversible actions. Make a backup first — Settings → Collection → Export full
            collection.
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
              className="btn btn-danger"
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
              <button type="button" className="btn btn-danger" onClick={() => setDeleteStep(1)}>
                Delete account
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── 8. Footer ─────────────────────────────────────────────────────── */}
      <footer className="settings-page-about">
        <p>
          SpellControl is unofficial Fan Content permitted under the{' '}
          <a
            href="https://company.wizards.com/en/legal/fancontentpolicy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Fan Content Policy
          </a>
          . Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards
          of the Coast. ©Wizards of the Coast LLC.
        </p>
        <p>
          Card data and images are provided by{' '}
          <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
            Scryfall
          </a>
          . SpellControl is not affiliated with Scryfall, ManaBox, Moxfield, Archidekt, Deckbox,
          TCGplayer, or Cardsphere.
        </p>
      </footer>

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

      {signOutOpen && (
        <ConfirmDialog
          title="Sign out?"
          body={
            signOutPending > 0
              ? `You have ${signOutPending} unsynced ${
                  signOutPending === 1 ? 'change' : 'changes'
                } that haven't reached the server yet. Signing out removes all data from this device — those changes will be lost.`
              : `Your data is synced to ${
                  username ? `@${username}` : 'your account'
                } and will be restored when you sign back in. It will be removed from this device.`
          }
          confirmLabel={signOutBusy ? 'Signing out…' : 'Sign out'}
          danger={signOutPending > 0}
          onConfirm={() => void handleLogout()}
          onCancel={() => setSignOutOpen(false)}
        />
      )}

      {resetCacheOpen && (
        <ConfirmDialog
          title="Reset app cache?"
          body="Clears the cached app bundles and reloads to fetch the latest version. Your decks, collection, and binders are kept."
          confirmLabel="Reset cache"
          onConfirm={() => void handleResetAppCache()}
          onCancel={() => setResetCacheOpen(false)}
        />
      )}

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
  const isFinal = step === 2;
  return (
    <Modal
      onClose={onCancel}
      dismissable={!busy}
      className="choice-dialog"
      labelledBy="delete-account-title"
    >
      <h2 id="delete-account-title" className="choice-dialog-title">
        {isFinal ? 'Last chance — delete your account?' : 'Delete your account?'}
      </h2>
      <p className="choice-dialog-body">
        {isFinal ? (
          <>
            This permanently deletes <strong>{username}</strong> and erases every server-side record
            — collection, binders, decks, games, backups, and share links. There is no undo.
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
    </Modal>
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
  const isFinal = step === 2;
  return (
    <Modal
      onClose={onCancel}
      dismissable={!busy}
      className="choice-dialog"
      labelledBy="wipe-collection-title"
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
            {cardCount === 1 ? 'card' : 'cards'} from your collection. Binder definitions and decks
            are kept, but decks will lose their physical copy assignments.
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
    </Modal>
  );
}
