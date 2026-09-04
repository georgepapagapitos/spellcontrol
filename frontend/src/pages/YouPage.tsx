import { logger } from '@/lib/logger';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSignInPath } from '../lib/sign-in-path';
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
import { useCurrencyStore, type Currency } from '../lib/currency';
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
import { isNativePlatform, openExternal } from '../lib/platform';
import { OfflineModeSettings } from '../components/OfflineModeSettings';
import { SharedLinksSettings } from '../components/SharedLinksSettings';
import { resetAppCacheAndReload } from '../lib/reset-app-cache';
import { AdminPanel } from '../components/AdminPanel';
import { AiFeaturesSettings } from '../components/settings/AiFeaturesSettings';
import { getPendingCount } from '../lib/sync';
import { ProfileEditor } from '../components/ProfileEditor';
import { TypeSetPicker } from '../components/TypeSetPicker';
import { SettingsSection } from '../components/settings/SettingsSection';
import { SettingsRow } from '../components/settings/SettingsRow';
import { scrollToHeading } from '../lib/scroll-to-heading';
import { listFriends } from '../lib/friends-client';
import { useFriendRequests } from '../lib/use-friend-requests';

import { userMessage } from '@/lib/user-error';
// Deep link (`/you?section=…`) → the heading to scroll/focus. Values are the
// linking door's own vocabulary (the header menu's "Profile" / "Settings" /
// "Shared links", the sync pill's Account, the auto-link banner's sign-in
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
  sharing: 'settings-sharing-group-title',
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
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section');
  const pageRef = useRef<HTMLDivElement>(null);

  // Friends pointer row (Identity tier) — a summary + link to /friends, not
  // the friend list itself (that's a real page now). Pending count reuses
  // the shared hook; the total is a best-effort fetch, same shape as the
  // identities fetch above.
  const pendingFriendRequests = useFriendRequests();
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
          message: userMessage(err, "Couldn't start linking."),
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
      <header className="binder-hero settings-page-hero">
        <div className="settings-page-hero-text">
          <h1 className="binder-hero-name">You</h1>
          <p className="binder-hero-meta">
            {username
              ? 'Profile, account, appearance, and data tools.'
              : 'Account, appearance, and data tools.'}
          </p>
        </div>
      </header>

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
              hint="Everything is saved on this device. Sign in to back it up and sync — the cards here are added to your account."
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
            hint="Add another way to sign in, or remove one — you always need at least one."
          >
            {/* Password row: status-only for now; action slot left open for a
                future Set/Change password flow to slot in. */}
            <SettingsRow label="Password" hint={identities.password ? 'Set' : 'Not set'} />
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
          hint="Theme re-skins the whole app to a guild palette."
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
          hint="A set changes every face at once — titles, body, labels, and numerals are picked to go together. Independent of theme."
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
                  label="binders and lists"
                  wide
                  text={
                    <>
                      <strong>Binders</strong> are rule-driven — you define filters (color, set,
                      rarity, etc.) and SpellControl automatically routes matching cards into them.
                      <br />
                      <br />
                      <strong>Lists</strong> are named groups of cards — hand-curated want lists
                      (cards to acquire), tracking lists (cards you own, catalogued outside your
                      binders), or dynamic lists driven by a rule like binders are.
                      <br />
                      <br />
                      The backup includes both binder rule definitions and lists.
                    </>
                  }
                />
              </>
            }
            valueWithTip
            hint="Download a JSON backup containing every card and binder definition."
            actions={
              <button
                type="button"
                className="btn"
                onClick={handleExportFull}
                disabled={cardCount === 0}
              >
                Download backup
              </button>
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
                  text="An allocation links each card slot in a deck to a specific physical copy in your collection — so if you own two copies of a card, SpellControl knows which one is claimed by which deck. Repair re-runs this matching after edits or re-imports."
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

      {/* Sharing (authed only — SharedLinksSettings self-hides for guests, so
          the whole group is suppressed when there's no username) */}
      {username && (
        <div role="group" aria-labelledby="settings-sharing-group-title">
          <h2 id="settings-sharing-group-title" className="settings-section-header">
            Sharing
          </h2>
          <SharedLinksSettings />
        </div>
      )}

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
      </div>

      {/* ═══ Admin (admin users only) ═════════════════════════════════════ */}
      {isAdmin && userId && (
        <div role="group" aria-labelledby="settings-admin-group-title">
          <h2 id="settings-admin-group-title" className="settings-section-header">
            Admin
          </h2>
          <AdminPanel currentUserId={userId} />
        </div>
      )}

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
            Irreversible actions. Make a backup first — Collection → Export full collection.
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

      {/* ═══ Footer ═══════════════════════════════════════════════════════ */}
      <footer className="settings-page-about">
        <p>
          SpellControl is unofficial Fan Content permitted under the{' '}
          <a
            href="https://company.wizards.com/en/legal/fancontentpolicy"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!isNativePlatform()) return;
              e.preventDefault();
              openExternal('https://company.wizards.com/en/legal/fancontentpolicy');
            }}
          >
            Fan Content Policy
          </a>
          . Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards
          of the Coast. ©Wizards of the Coast LLC.
        </p>
        <p>
          Card data and images are provided by{' '}
          <a
            href="https://scryfall.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!isNativePlatform()) return;
              e.preventDefault();
              openExternal('https://scryfall.com');
            }}
          >
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
        {isFinal ? 'Last chance — delete everything?' : 'Delete entire collection?'}
      </h2>
      <p className="choice-dialog-body">
        {isFinal ? (
          <>
            This will permanently remove <strong>{frozenCount.toLocaleString()}</strong>{' '}
            {frozenCount === 1 ? 'card' : 'cards'} and the import history. Your binders stay defined
            but will be empty. There is no undo.
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
