import { logger } from '@/lib/logger';
import { PageHeader } from '@/components/PageHeader';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { preventFocusSteal } from '../lib/keyboard';
// Admin + scanner sheet: shared with AdminPage and CardScanner, off the boot payload (E265).
import '@/styles/admin-scanner.css';
import { useSignInPath } from '../lib/sign-in-path';
import { useAuth } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { THEMES } from '../lib/themes';
import { toast } from '../store/toasts';
import { buildBackup, downloadBackup } from '../lib/backup';
import { CollectionExportDialog } from '../components/CollectionExportDialog';
import { Modal } from '../components/Modal';
import { formatPricedDate, newestPricedAt } from '../lib/price-freshness';
import { useCurrencyStore, type Currency } from '../lib/currency';
import {
  fetchIdentities,
  googleLinkUrl,
  requestEmailChange,
  resendEmailVerification,
  setNotifyEmail,
  unlinkGoogle,
  updatePassword,
  type MyIdentities,
} from '../lib/auth-api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { InfoTip } from '../components/InfoTip';
import { SyncIndicator } from '../components/SyncIndicator';
import { OfflineModeSettings } from '../components/OfflineModeSettings';
import { resetAppCacheAndReload } from '../lib/reset-app-cache';
import { AiFeaturesSettings } from '../components/settings/AiFeaturesSettings';
import { getPendingCount } from '../lib/sync';
import { ProfileEditor } from '../components/ProfileEditor';
import { UsernameEditor } from '../components/UsernameEditor';
import { TypeSetPicker } from '../components/TypeSetPicker';
import { SettingsSection } from '../components/settings/SettingsSection';
import { SettingsRow } from '../components/settings/SettingsRow';
import { scrollToHeading } from '../lib/scroll-to-heading';
import { track } from '../lib/analytics';
import { listFriends } from '../lib/friends-client';
import { useFriendRequests } from '../lib/use-friend-requests';

import { userMessage } from '@/lib/user-error';
// Deep link (`/you?section=…`) → the heading to scroll/focus. Values are the
// linking door's own vocabulary (the header menu's "Profile" / "Settings" /
// old "Shared links" item, the sync pill's Account, the auto-link banner's sign-in
// methods), not the heading ids themselves, so a rename of one heading only
// needs updating here. `settings` lands on the Preferences tier header — the
// page is "You"; Settings is everything below Identity, and that tier header
// is where it starts. Every heading here must exist in the render below (a
// missing id makes the link a silent no-op — `profile`, `account`,
// `collection` and `danger` shipped that way once).
const SECTION_HEADING_IDS: Record<string, string> = {
  profile: 'settings-profile-title',
  account: 'settings-account-title',
  'sign-in': 'settings-signin-title',
  settings: 'settings-preferences-tier-title',
  appearance: 'settings-appearance-group-title',
  'collection-preferences': 'settings-collection-prefs-group-title',
  collection: 'settings-collection-title',
  // The Sharing group is gone (board T136); old links land on Profile.
  sharing: 'settings-profile-title',
  data: 'settings-data-group-title',
  ai: 'settings-ai-group-title',
  admin: 'settings-admin-group-title',
  danger: 'settings-danger-title',
};

// How long after a `?section=` arrival the page keeps re-pinning the target
// heading while cards above it are still arriving (the Sign-in methods card
// renders after the identities fetch; the share-link list after its own).
// Long enough for a slow fetch, short enough that a later resize (the user
// expanding something) never yanks the page.
const SECTION_SETTLE_MS = 3000;

function friendsSummary(count: number | null, pending: number): string {
  if (count === null) return 'Manage friend requests and shared collections.';
  const friendsPart = `${count} ${count === 1 ? 'friend' : 'friends'}`;
  if (pending === 0) return `${friendsPart}.`;
  const pendingPart = `${pending} pending ${pending === 1 ? 'request' : 'requests'}`;
  return `${friendsPart} · ${pendingPart}.`;
}

export function YouPage() {
  const username = useAuth((s) => s.user?.username ?? null);
  const signInHref = useSignInPath();
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
  const reapplyCardPrices = useCollectionStore((s) => s.reapplyCardPrices);
  const currency = useCurrencyStore((s) => s.currency);
  const setCurrency = useCurrencyStore((s) => s.setCurrency);
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
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailResendBusy, setEmailResendBusy] = useState(false);
  const [notifyEmailBusy, setNotifyEmailBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section');
  const pageRef = useRef<HTMLDivElement>(null);

  // Friends pointer row (Identity tier) — a summary + link to /friends, not
  // the friend list itself (that's a real page now). Pending count reuses
  // the shared hook; the total is a best-effort fetch, same shape as the
  // identities fetch above.
  const { count: pendingFriendRequests } = useFriendRequests();
  const [friendCount, setFriendCount] = useState<number | null>(null);

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

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    listFriends()
      .then((r) => {
        if (!cancelled) setFriendCount(r.length);
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

  // Deep-link arrival (header account menu, sync pill, auto-link banner,
  // command palette): scroll the matching heading into view and focus it. An
  // absent or unknown `section` value is a no-op — the page just stays
  // wherever it naturally lands.
  //
  // One scroll on mount isn't enough for a signed-in player: the Sign-in
  // methods card (and, lower down, the share-link list) render after their
  // fetches resolve and push the target down by a card's height, which left
  // "Settings" landing on the Friends card instead of Appearance. So for a
  // short settle window, every layout change of the page re-pins the same
  // heading. Focus is announced exactly once — on the first scroll that
  // actually finds the heading, which for a target that is itself one of
  // the late cards (`sign-in`) is a later pass, not the mount. The first
  // pointer, wheel or key from the user ends the window early so a late
  // resize can never yank a page they have started to read.
  useEffect(() => {
    const id = sectionParam ? SECTION_HEADING_IDS[sectionParam] : undefined;
    if (!id) return;
    let announced = scrollToHeading(id);
    const root = pageRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (scrollToHeading(id, { focus: !announced })) announced = true;
    });
    observer.observe(root);
    const stop = () => observer.disconnect();
    const timer = window.setTimeout(stop, SECTION_SETTLE_MS);
    const interactions = ['pointerdown', 'wheel', 'keydown'] as const;
    interactions.forEach((type) => window.addEventListener(type, stop, { passive: true }));
    return () => {
      stop();
      window.clearTimeout(timer);
      interactions.forEach((type) => window.removeEventListener(type, stop));
    };
  }, [sectionParam]);

  function handleLinkGoogle() {
    setLinkBusy(true);
    window.location.href = googleLinkUrl();
  }

  async function refreshIdentities() {
    try {
      setIdentities(await fetchIdentities());
    } catch {
      /* ignore — the row keeps showing whatever it last knew */
    }
  }

  async function handleResendVerification() {
    setEmailResendBusy(true);
    try {
      await resendEmailVerification();
      toast.show({ message: 'Verification email sent.', tone: 'success' });
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't resend the verification email."),
        tone: 'error',
      });
    } finally {
      setEmailResendBusy(false);
    }
  }

  async function handleToggleNotifyEmail() {
    if (!identities) return;
    const next = !identities.notifyEmail;
    setNotifyEmailBusy(true);
    setIdentities({ ...identities, notifyEmail: next }); // optimistic
    try {
      await setNotifyEmail(next);
    } catch (err) {
      setIdentities(identities); // revert
      toast.show({
        message: userMessage(err, "Couldn't update email notifications."),
        tone: 'error',
      });
    } finally {
      setNotifyEmailBusy(false);
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
        message: userMessage(err, "Couldn't unlink Google."),
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

  function handleCurrencyChange(next: Currency) {
    if (next === currency) return;
    setCurrency(next);
    // Flip the whole UI instantly from cached values in the new currency…
    reapplyCardPrices();
    // …then backfill anything the device hasn't fetched in that currency yet
    // (cache entries from before EUR support come back unpriced). Tracked so
    // the global progress pill shows why numbers are filling in.
    if (useCollectionStore.getState().cards.some((c) => !c.pricedAt)) {
      refreshPrices(undefined, { track: true }).catch((err: unknown) => {
        toast.show({
          message: userMessage(err, "Couldn't refresh prices. Try again in a moment."),
          tone: 'error',
        });
      });
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
        message: userMessage(err, "Couldn't refresh prices. Try again in a moment."),
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
    downloadBackup(buildBackup(snapshot.collection, snapshot.binders, decks));
    toast.show({ message: 'Backup downloaded.', tone: 'success' });
  }

  const [exportOpen, setExportOpen] = useState(false);

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
          message: useAuth.getState().error ?? "Couldn't delete your account. Try again.",
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
        message:
          "Couldn't reset the app cache. Try clearing this site's data in your browser settings.",
        tone: 'error',
      });
      setResetCacheBusy(false);
    }
  }

  return (
    <div className="settings-page" ref={pageRef}>
      {/* The page is "You" — the phone tab, the route and the command palette
          all say so, and the first tier is who you are. Settings is the part
          below Identity, not the page's name. The meta line names only what
          this reader will actually find: a guest has no Profile card. */}
      <PageHeader
        title="You"
        className="settings-page-hero"
        meta={
          username
            ? 'Profile, account, appearance, and data tools.'
            : 'Account, appearance, and data tools.'
        }
      />

      {/* ═══ Identity — who you are ══════════════════════════════════════ */}
      <h2 id="settings-identity-tier-title" className="settings-tier-header">
        Identity
      </h2>

      {username && (
        <div>
          <SettingsSection
            id="settings-profile-title"
            title="Profile"
            hint={
              <>
                Shown on your <Link to={`/u/${username}`}>public profile</Link> and anywhere you
                appear to other players.
              </>
            }
          >
            <ProfileEditor />
          </SettingsSection>
          <SettingsSection
            id="settings-username-title"
            title="Username"
            hint="Your handle, separate from your display name. Changing it moves your profile address."
          >
            <UsernameEditor />
          </SettingsSection>
        </div>
      )}

      <div>
        <SettingsSection id="settings-account-title" title="Account">
          {username ? (
            <>
              <SettingsRow
                label="Signed in as"
                value={username}
                actions={
                  <button type="button" className="btn" onClick={openSignOut}>
                    Sign out
                  </button>
                }
              />
              <SettingsRow label="Sync status" actions={<SyncIndicator />} />
            </>
          ) : (
            <SettingsRow
              label="Not signed in"
              hint="Everything is saved on this device. Sign in to back it up and sync the cards here into your account."
              actions={
                <Link to={signInHref} className="pill-btn pill-btn-primary">
                  Sign in to sync
                </Link>
              }
            />
          )}
        </SettingsSection>

        {username && identities && (
          <SettingsSection
            id="settings-signin-title"
            title="Sign-in methods"
            hint="Add another way to sign in, or remove one. You always need at least one."
          >
            <SettingsRow
              label="Password"
              hint={identities.password ? 'Set' : 'Not set'}
              actions={
                <button type="button" className="btn" onClick={() => setPasswordModalOpen(true)}>
                  {identities.password ? 'Change password' : 'Set password'}
                </button>
              }
            />
            <SettingsRow
              label="Email"
              hint={
                identities.emailVerified && identities.pendingEmail
                  ? `${identities.email}, change to ${identities.pendingEmail} pending verification`
                  : identities.emailVerified
                    ? identities.email
                    : identities.pendingEmail
                      ? `Pending verification, ${identities.pendingEmail}`
                      : 'Not set'
              }
              actions={
                <>
                  {identities.pendingEmail && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void handleResendVerification()}
                      disabled={emailResendBusy}
                    >
                      {emailResendBusy ? 'Sending…' : 'Resend'}
                    </button>
                  )}
                  <button type="button" className="btn" onClick={() => setEmailModalOpen(true)}>
                    {identities.emailVerified || identities.pendingEmail ? 'Change' : 'Add'}
                  </button>
                </>
              }
            >
              {!identities.emailVerified && (
                <div className="settings-row-hint">
                  Add a verified email so you can reset your password if you get locked out.
                </div>
              )}
            </SettingsRow>
            <SettingsRow
              label="Email notifications"
              hint={
                identities.emailVerified
                  ? 'Get emailed for new friend requests, trade offers, and game-night invites.'
                  : 'Add a verified email above to get these.'
              }
              actions={
                <button
                  type="button"
                  role="switch"
                  aria-checked={identities.notifyEmail}
                  aria-label="Email notifications"
                  className={`btn settings-switch${identities.notifyEmail ? ' is-on' : ''}`}
                  disabled={!identities.emailVerified || notifyEmailBusy}
                  onClick={() => void handleToggleNotifyEmail()}
                >
                  {identities.notifyEmail ? 'On' : 'Off'}
                </button>
              }
            />
            <SettingsRow
              label="Google"
              hint={identities.google ? 'Linked' : 'Not linked'}
              actions={
                identities.google ? (
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
                )
              }
            />
          </SettingsSection>
        )}

        {username && (
          <SettingsSection id="settings-friends-title" title="Friends">
            <SettingsRow
              value="Friends"
              hint={friendsSummary(friendCount, pendingFriendRequests)}
              actions={
                <Link to="/friends" className="btn">
                  Manage friends
                </Link>
              }
            />
          </SettingsSection>
        )}
      </div>

      {/* ═══ Preferences — set-and-forget defaults ═══════════════════════ */}
      <h2 id="settings-preferences-tier-title" className="settings-tier-header">
        Preferences
      </h2>

      <div role="group" aria-labelledby="settings-appearance-group-title">
        <h2 id="settings-appearance-group-title" className="settings-section-header">
          Appearance
        </h2>
        <SettingsSection
          id="settings-appearance-title"
          title="Theme"
          hint="Theme re-skins the whole app. Obsidian is true black, for OLED screens."
        >
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
        </SettingsSection>

        <SettingsSection
          id="settings-typeface-title"
          title="Typeface"
          hint="A set changes every face at once: titles, body, labels, and numerals, picked to go together. Independent of theme."
        >
          <TypeSetPicker />
        </SettingsSection>
      </div>

      <div role="group" aria-labelledby="settings-collection-prefs-group-title">
        <h2 id="settings-collection-prefs-group-title" className="settings-section-header">
          Collection preferences
        </h2>
        <SettingsSection
          id="settings-collection-prefs-title"
          title="Price currency"
          hint="Show card prices and collection value in USD (TCGplayer) or EUR (Cardmarket)."
        >
          <fieldset className="settings-currency-toggle" aria-label="Price currency">
            {(['USD', 'EUR'] as const).map((c) => (
              <label key={c} className="settings-currency-option">
                <input
                  type="radio"
                  name="price-currency"
                  value={c}
                  checked={currency === c}
                  onChange={() => handleCurrencyChange(c)}
                />
                <span>{c === 'USD' ? '$ USD' : '€ EUR'}</span>
              </label>
            ))}
          </fieldset>
        </SettingsSection>
      </div>

      {/* AI features (T96) — renders nothing unless the backend has the
          feature configured and the user is signed in. */}
      <AiFeaturesSettings />

      {/* ═══ Your data — backup, sharing, storage ════════════════════════ */}
      <h2 id="settings-your-data-tier-title" className="settings-tier-header">
        Your data
      </h2>

      <div>
        <SettingsSection
          id="settings-collection-title"
          title="Collection"
          hint="Back up and keep card data fresh. Exports are JSON files you can re-import later."
        >
          <SettingsRow
            value={
              <>
                Export full collection
                <InfoTip
                  label="binders, lists, and decks"
                  wide
                  text={
                    <>
                      <strong>Binders</strong> sort your cards by rules you set: color, set, rarity,
                      and more.
                      <br />
                      <br />
                      <strong>Lists</strong> are named groups: want lists, tracking lists, or
                      rule-driven dynamic lists.
                      <br />
                      <br />
                      The JSON backup includes binders, lists, and every deck; a re-import restores
                      all of it. Export is cards only, one row per copy, as a SpellControl, Moxfield
                      or Archidekt CSV or an Arena text list.
                    </>
                  }
                />
              </>
            }
            valueWithTip
            hint="Download a JSON backup (every card, binder, list, and deck) or a cards-only file for another tool."
            actions={
              <div className="settings-row-action-group">
                <button
                  type="button"
                  className="btn"
                  aria-haspopup="dialog"
                  onClick={() => setExportOpen(true)}
                  disabled={cardCount === 0}
                >
                  Export
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleExportFull}
                  disabled={cardCount === 0}
                >
                  Download backup
                </button>
              </div>
            }
          />

          <SettingsRow
            value="Refresh card prices"
            hint={
              <>
                Re-fetch {currency} prices from Scryfall for every card in your collection.
                {pricesUpdated && ` Last updated ${pricesUpdated}.`}
              </>
            }
            actions={
              <button
                type="button"
                className="btn"
                onClick={() => void handleRefreshPrices()}
                disabled={cardCount === 0 || isRefreshingPrices}
              >
                {isRefreshingPrices ? 'Refreshing…' : 'Refresh prices'}
              </button>
            }
          />

          <SettingsRow
            value={
              <>
                Repair deck allocations
                <InfoTip
                  label="deck allocations"
                  text="An allocation links a deck slot to one physical copy, so owning two copies of a card doesn't leave it ambiguous which deck claims which. Repair re-runs the match after edits or re-imports."
                />
              </>
            }
            valueWithTip
            hint="Re-map each deck's reserved copies after edits or re-imports."
            actions={
              <button
                type="button"
                className="btn"
                onClick={handleRepairAllocations}
                disabled={cardCount === 0 || deckCount === 0}
              >
                Repair
              </button>
            }
          />
        </SettingsSection>
      </div>

      <div role="group" aria-labelledby="settings-data-group-title">
        <h2 id="settings-data-group-title" className="settings-section-header">
          Data &amp; storage
        </h2>

        <OfflineModeSettings />

        <SettingsSection
          id="settings-troubleshooting-title"
          title="Troubleshooting"
          hint="For when the app feels stuck on an old version after an update."
        >
          <SettingsRow
            value="Reset app cache"
            hint="Reloads the app from the server. Your decks, collection, and binders aren't touched."
            actions={
              <button
                type="button"
                className="btn"
                onClick={() => setResetCacheOpen(true)}
                disabled={resetCacheBusy}
              >
                {resetCacheBusy ? 'Resetting…' : 'Reset cache'}
              </button>
            }
          />
        </SettingsSection>

        <SettingsSection id="settings-help-title" title="Help">
          <SettingsRow
            value="Rules reference"
            hint="Keywords, the glossary, and every rule by number from the Comprehensive Rules."
            actions={
              <Link to="/rules" className="btn">
                Open rules
              </Link>
            }
          />
          <SettingsRow
            value="Help & guides"
            hint="Import walkthroughs, binder setup, and format comparisons."
            actions={
              <a href="/guides/" className="btn" onClick={() => track('guide_cta')}>
                Open guides
              </a>
            }
          />
        </SettingsSection>
      </div>

      {/* ═══ Danger zone ═══════════════════════════════════════════════════ */}
      <section
        className="settings-card settings-card--danger"
        aria-labelledby="settings-danger-title"
      >
        <header className="settings-card-header">
          <h2 id="settings-danger-title" className="settings-card-title">
            Danger zone
          </h2>
          <p className="settings-card-hint">
            Irreversible actions. Make a backup first: Collection → Export full collection.
          </p>
        </header>
        <div className="settings-card-body">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-value">Delete entire collection</div>
              <div className="settings-row-hint">
                Removes every card and import-history entry. Binder definitions stay, with nothing
                left to match against.
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
                  Permanently deletes your account and everything on the server: collection,
                  binders, decks, games, backups, share links. This can't be undone.
                </div>
              </div>
              <button type="button" className="btn btn-danger" onClick={() => setDeleteStep(1)}>
                Delete account
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ═══ Footer ═══════════════════════════════════════════════════════ */}
      <footer className="settings-page-about">
        <p>
          <a href="/privacy.html">Privacy Policy</a> · <a href="/terms.html">Terms of Service</a>
        </p>
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
      </footer>

      {unlinkOpen && (
        <ConfirmDialog
          title="Unlink Google?"
          body="You can re-link any time. Your account and data stay intact, and only the Google sign-in shortcut is removed."
          confirmLabel={unlinkBusy ? 'Unlinking…' : 'Unlink'}
          danger
          onConfirm={() => void handleUnlinkGoogle()}
          onCancel={() => setUnlinkOpen(false)}
        />
      )}

      {passwordModalOpen && identities && (
        <PasswordModal
          hasPassword={identities.password}
          onClose={() => setPasswordModalOpen(false)}
          onSaved={() => void refreshIdentities()}
        />
      )}

      {emailModalOpen && identities && (
        <EmailModal
          currentEmail={identities.emailVerified ? identities.email : null}
          onClose={() => setEmailModalOpen(false)}
          onSaved={() => void refreshIdentities()}
        />
      )}

      {exportOpen && <CollectionExportDialog cards={cards} onClose={() => setExportOpen(false)} />}

      {signOutOpen && (
        <ConfirmDialog
          title="Sign out?"
          body={
            signOutPending > 0
              ? `You have ${signOutPending} unsynced ${
                  signOutPending === 1 ? 'change' : 'changes'
                } that haven't reached the server yet. Signing out removes all data from this device, and those changes will be lost.`
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

interface PasswordModalProps {
  /** Whether the account already has a password — gates the "current
   *  password" field and swaps the modal between Set/Change copy. */
  hasPassword: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Set (no existing password — an SSO-only account) or change (existing
 * password, `currentPassword` required and verified server-side) the
 * account's password. Reuses AuthPage's `.auth-field`/`.auth-rules` markup
 * and reveal-toggle pattern so a password field looks and behaves the same
 * everywhere in the app.
 */
function PasswordModal({ hasPassword, onClose, onSaved }: PasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError(null);
      setConfirmError('Passwords do not match.');
      return;
    }
    setConfirmError(null);
    setError(null);
    setSaving(true);
    try {
      await updatePassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
      });
      toast.show({ message: hasPassword ? 'Password changed.' : 'Password set.', tone: 'success' });
      onSaved();
      onClose();
    } catch (err) {
      setError(userMessage(err, "Couldn't update your password."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      dismissable={!saving}
      className="choice-dialog"
      labelledBy="password-modal-title"
    >
      <h2 id="password-modal-title" className="choice-dialog-title">
        {hasPassword ? 'Change password' : 'Set a password'}
      </h2>
      <form onSubmit={(e) => void handleSubmit(e)} className="auth-form">
        {hasPassword && (
          <label className="auth-field">
            <span>Current password</span>
            <div className="auth-input-wrap">
              <input
                type={showCurrent ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
              />
              <button
                type="button"
                className="auth-reveal"
                onMouseDown={preventFocusSteal}
                onClick={() => setShowCurrent((v) => !v)}
                aria-pressed={showCurrent}
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
              >
                {showCurrent ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
              </button>
            </div>
          </label>
        )}

        <label className="auth-field">
          <span>New password</span>
          <div className="auth-input-wrap">
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={10}
              autoFocus={!hasPassword}
            />
            <button
              type="button"
              className="auth-reveal"
              onMouseDown={preventFocusSteal}
              onClick={() => setShowNew((v) => !v)}
              aria-pressed={showNew}
              aria-label={showNew ? 'Hide password' : 'Show password'}
            >
              {showNew ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </div>
          <ul className="auth-rules" aria-label="Password requirements" aria-live="polite">
            <li
              className={`auth-rule${newPassword.length >= 10 ? ' is-met' : ''}`}
              aria-label={`At least 10 characters: ${newPassword.length >= 10 ? 'met' : 'not yet met'}`}
            >
              <span className="auth-rule-mark" aria-hidden="true">
                {newPassword.length >= 10 ? '✓' : '•'}
              </span>
              At least 10 characters
            </li>
          </ul>
        </label>

        <label className="auth-field">
          <span>Confirm new password</span>
          <div className="auth-input-wrap">
            <input
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (confirmError) setConfirmError(null);
              }}
              required
              minLength={10}
              aria-invalid={confirmError ? true : undefined}
            />
            <button
              type="button"
              className="auth-reveal"
              onMouseDown={preventFocusSteal}
              onClick={() => setShowConfirm((v) => !v)}
              aria-pressed={showConfirm}
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
            >
              {showConfirm ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </div>
          <ul className="auth-rules" aria-label="Confirm requirements" aria-live="polite">
            <li
              className={`auth-rule${confirm.length > 0 && confirm === newPassword ? ' is-met' : ''}${confirmError ? ' is-error' : ''}`}
              aria-label={`Passwords match: ${confirm.length > 0 && confirm === newPassword ? 'met' : 'not yet met'}`}
            >
              <span className="auth-rule-mark" aria-hidden="true">
                {confirm.length > 0 && confirm === newPassword ? '✓' : '•'}
              </span>
              Passwords match
            </li>
          </ul>
        </label>

        {error || confirmError ? (
          <div role="alert" className="auth-error">
            {error || confirmError}
          </div>
        ) : null}

        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface EmailModalProps {
  /** The account's current verified email, or null (unset / still pending). */
  currentEmail: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Add or change the account's email. Doesn't take effect immediately — the
 * backend mails a verification link and the row shows "Pending
 * verification" until it's clicked (see VerifyEmailPage).
 */
function EmailModal({ currentEmail, onClose, onSaved }: EmailModalProps) {
  const [email, setEmail] = useState(currentEmail ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { pendingEmail } = await requestEmailChange(email.trim());
      toast.show({ message: `Verification email sent to ${pendingEmail}.`, tone: 'success' });
      onSaved();
      onClose();
    } catch (err) {
      setError(userMessage(err, "Couldn't update your email."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      dismissable={!saving}
      className="choice-dialog"
      labelledBy="email-modal-title"
    >
      <h2 id="email-modal-title" className="choice-dialog-title">
        {currentEmail ? 'Change email' : 'Add an email'}
      </h2>
      <p className="choice-dialog-body">
        We'll send a link to confirm this address before it's saved to your account.
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="auth-form">
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>

        {error ? (
          <div role="alert" className="auth-error">
            {error}
          </div>
        ) : null}

        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Sending…' : 'Send verification link'}
          </button>
        </div>
      </form>
    </Modal>
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
        {isFinal ? 'Last chance: delete your account?' : 'Delete your account?'}
      </h2>
      <p className="choice-dialog-body">
        {isFinal ? (
          <>
            This permanently deletes <strong>{username}</strong> and erases every server-side
            record: collection, binders, decks, games, backups, share links. This can't be undone.
          </>
        ) : (
          <>
            This permanently deletes the account <strong>{username}</strong> and all of its data
            from the server. Export a backup first (Collection → Export full collection) if you want
            to keep your collection.
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
  // Freeze the count at open. `cardCount` is live store state that the very
  // delete this dialog describes is concurrently zeroing, so while the wipe
  // ran the still-mounted dialog re-rendered as "permanently remove 0 cards"
  // before `setWipeStep(0)` landed — reading as "I confirmed and it just sat
  // there." What the user agreed to is the number they were shown.
  const [frozenCount] = useState(cardCount);
  return (
    <Modal
      onClose={onCancel}
      dismissable={!busy}
      className="choice-dialog"
      labelledBy="wipe-collection-title"
    >
      <h2 id="wipe-collection-title" className="choice-dialog-title">
        {isFinal ? 'Last chance: delete everything?' : 'Delete entire collection?'}
      </h2>
      <p className="choice-dialog-body">
        {isFinal ? (
          <>
            This will permanently remove <strong>{frozenCount.toLocaleString()}</strong>{' '}
            {frozenCount === 1 ? 'card' : 'cards'} and the import history. Your binders stay defined
            but will be empty. This can't be undone.
          </>
        ) : (
          <>
            You're about to remove all <strong>{frozenCount.toLocaleString()}</strong>{' '}
            {frozenCount === 1 ? 'card' : 'cards'} from your collection. Binder definitions and
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
    </Modal>
  );
}
