import { logger } from '@/lib/logger';
import { BrandMark } from '@/components/shared/BrandMark';
import { lazy, Suspense, useEffect, useRef, type ComponentType } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CollectionHubLayout } from './components/CollectionHubLayout';
// Eager pages — the entry surfaces a first paint lands on. WelcomePage is the
// marketing landing (guest-fresh "/"), HomePage the authed default, and the
// auth pair is where the first-run gate sends a brand-new install. Everything
// else is lazy: each hub loads its chunk on first visit, so the boot bundle
// stops shipping the deck builder, the play table, and the admin panel to
// someone who came to look at their binders.
import { HomePage } from './pages/HomePage';
import { WelcomePage } from './pages/WelcomePage';
import AuthPage from './pages/AuthPage';
import ChooseUsernamePage from './pages/ChooseUsernamePage';
import { useAuth } from './store/auth';
import { useCollectionStore } from './store/collection';
import { startSync, hydrateLocal } from './lib/sync';
import { autoSyncOfflineData, registerOfflineSyncOnResume } from './lib/offline/auto-sync';
import { initDeepLinks } from './lib/deep-links';
import { setAppNavigator } from './lib/navigate-bridge';
import { AutoLinkBanner } from './components/AutoLinkBanner';
import { useFirstRunGate } from './lib/use-first-run-gate';
import { useTradeSettlement } from './lib/use-trade-settlement';
import { hasEverVisited } from './lib/first-run';

/** Named-export adapter for React.lazy (every page below exports by name). */
function lazyPage<K extends string, T extends Record<K, ComponentType>>(
  load: () => Promise<T>,
  name: K
) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

// Collection hub
const CollectionPage = lazyPage(() => import('./pages/CollectionPage'), 'CollectionPage');
const BinderPage = lazyPage(() => import('./pages/BinderPage'), 'BinderPage');
const BindersIndexPage = lazyPage(() => import('./pages/BindersIndexPage'), 'BindersIndexPage');
const ListsPage = lazyPage(() => import('./pages/ListsPage'), 'ListsPage');
const CollectionCombosPage = lazyPage(
  () => import('./pages/CollectionCombosPage'),
  'CollectionCombosPage'
);
const SetsPage = lazyPage(() => import('./pages/SetsPage'), 'SetsPage');
// Decks hub
const DecksIndexPage = lazyPage(() => import('./pages/DecksIndexPage'), 'DecksIndexPage');
const DiscoverDecksPage = lazyPage(() => import('./pages/DiscoverDecksPage'), 'DiscoverDecksPage');
const SavedDecksPage = lazyPage(() => import('./pages/SavedDecksPage'), 'SavedDecksPage');
const DeckNewPage = lazyPage(() => import('./pages/DeckNewPage'), 'DeckNewPage');
const BrewBuildPage = lazyPage(() => import('./pages/BrewBuildPage'), 'BrewBuildPage');
const DeckEditorPage = lazyPage(() => import('./pages/DeckEditorPage'), 'DeckEditorPage');
const DeckComparePage = lazyPage(() => import('./pages/DeckComparePage'), 'DeckComparePage');
const CubePage = lazyPage(() => import('./pages/CubePage'), 'CubePage');
// Play
const PlayPage = lazyPage(() => import('./pages/PlayPage'), 'PlayPage');
const PlaytestPage = lazyPage(() => import('./pages/PlaytestPage'), 'PlaytestPage');
// Social
const YouPage = lazyPage(() => import('./pages/YouPage'), 'YouPage');
const FriendsPage = lazyPage(() => import('./pages/FriendsPage'), 'FriendsPage');
const FriendHubPage = lazyPage(() => import('./pages/FriendHubPage'), 'FriendHubPage');
const TradesPage = lazyPage(() => import('./pages/TradesPage'), 'TradesPage');
const PodsIndexPage = lazyPage(() => import('./pages/PodsIndexPage'), 'PodsIndexPage');
const PodHubPage = lazyPage(() => import('./pages/PodHubPage'), 'PodHubPage');
// Utility / public
const SearchPage = lazyPage(() => import('./pages/SearchPage'), 'SearchPage');
const TagsPage = lazyPage(() => import('./pages/TagsPage'), 'TagsPage');
const RulesPage = lazyPage(() => import('./pages/RulesPage'), 'RulesPage');
const AdminPage = lazyPage(() => import('./pages/AdminPage'), 'AdminPage');
const SharedView = lazyPage(() => import('./pages/SharedView'), 'SharedView');
const PublicProfilePage = lazyPage(() => import('./pages/PublicProfilePage'), 'PublicProfilePage');
const PublicDeckPage = lazyPage(() => import('./pages/PublicDeckPage'), 'PublicDeckPage');
const GameNightView = lazyPage(() => import('./pages/GameNightView'), 'GameNightView');
const GameNightSeriesView = lazyPage(
  () => import('./pages/GameNightSeriesView'),
  'GameNightSeriesView'
);
const GameNightInviteView = lazyPage(
  () => import('./pages/GameNightLinkForward'),
  'GameNightInviteView'
);

// Fallback for the OAuth App Link landing path. In the happy path Android
// intercepts https://spellcontrol.com/oauth/callback and hands the URL to
// the installed APK, where deep-links.ts finishes the sign-in — so this
// component is never rendered. It exists for the rare case where App Link
// verification glitches (cleared defaults, unverified install) and the URL
// loads in the system browser SPA instead.
//
// On Android we offer a Chrome-specific intent:// URL that explicitly names
// the SpellControl package, which forces the OS to hand the URL to our APK
// even when the App Link auto-verify chain didn't fire.
function OAuthCallbackLanding() {
  const [params] = useSearchParams();
  const hasPayload = params.has('code') || params.has('signup');
  const errored = params.has('error') || params.has('linkError');
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const intentUrl = `intent://spellcontrol.com/oauth/callback?${params.toString()}#Intent;scheme=https;package=com.spellcontrol.app;end`;

  // The only state with genuinely nothing to act on: no payload, no error.
  // Every other branch describes an in-progress or failed attempt, so
  // "Continue on the web instead" stays a sensible fallback for all of them.
  const nothingToFinish = !errored && !hasPayload;

  let title: string;
  let message: string;
  if (errored) {
    title = 'Sign-in didn’t finish';
    message = 'Open SpellControl and try signing in again.';
  } else if (!hasPayload) {
    title = 'Nothing to finish here';
    message = 'You can safely close this tab.';
  } else if (isAndroid) {
    title = 'Almost there';
    message = 'Tap below to finish signing in inside SpellControl.';
  } else {
    title = 'Finish on your phone';
    message = 'Open SpellControl on the device you started signing in on.';
  }

  return (
    <main className="auth-page">
      <div className="auth-card auth-callback-card" role="status">
        <div className="auth-brand-hero" aria-hidden="true">
          <BrandMark size={48} motion="idle" />
        </div>
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{message}</p>
        {hasPayload && isAndroid ? (
          <a className="auth-submit auth-submit-link" href={intentUrl}>
            Open SpellControl
          </a>
        ) : null}
        {/* Nothing to finish here already tells the user it's safe to close
            the tab — a "continue" link right underneath would contradict
            that, so it only shows when there's an actual sign-in to resume
            or retry (errored counts — retrying is exactly the point). */}
        {!nothingToFinish ? (
          <a className="auth-back" href="/">
            Continue on the web instead
          </a>
        ) : null}
      </div>
    </main>
  );
}

/**
 * Full-viewport brand splash. Doubles as the auth-bootstrap holding state and
 * the Suspense fallback for lazy routes that render OUTSIDE <Layout/> (share
 * links, public profiles, game night) — for those the chunk fetch happens
 * before any app chrome exists, so the splash is the same visual the user is
 * already looking at during boot. In-Layout routes never reach this boundary;
 * Layout carries its own in-chrome fallback so the header and tab bar stay
 * put while a hub's chunk loads.
 */
function BootSplash() {
  return (
    <div
      className="auth-page brand-boot"
      aria-busy="true"
      role="status"
      aria-label="Loading SpellControl"
    >
      <BrandMark size={96} motion="boot" aria-hidden />
    </div>
  );
}

/** `/collection/cube/:id` lived under Collection before the cube moved to the
 *  Decks hub — forward saved links and muscle memory to the new home. */
function LegacyCubeRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/decks/cube/${id}` : '/decks/cube'} replace />;
}

export default function App() {
  const status = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id);
  const username = useAuth((s) => s.user?.username);
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const bootstrap = useAuth((s) => s.bootstrap);
  const syncStartedFor = useRef<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // First-run gate: on a brand-new install, send the user to /auth before
  // dropping them into the app. The gate flips off as soon as any
  // intentional first auth choice is made (login, register, finish Google
  // sign-in, or "Continue without an account"). Only fires once status
  // has resolved to 'guest'; the bootstrap loading window is ignored.
  useFirstRunGate(status);

  // Subscribe to native deep links once per mount. `initDeepLinks` is a
  // no-op on web, so the listener is only ever registered inside the
  // Capacitor APK. The teardown drops the listener if React ever remounts
  // App (StrictMode, fast-refresh) so we don't double-handle URLs.
  useEffect(() => initDeepLinks(navigate), [navigate]);

  // Hand the router to non-React callers (e.g. binder-move toasts fired from
  // the collection store need to route to the destination binder on tap).
  useEffect(() => {
    setAppNavigator(navigate);
    return () => setAppNavigator(null);
  }, [navigate]);

  // Re-check the offline card catalog whenever the app returns to the
  // foreground. No-op on web; throttled so frequent resumes don't spam the
  // manifest endpoint. Keeps a long-lived native session from drifting onto
  // stale data between cold starts.
  useEffect(() => registerOfflineSyncOnResume(), []);

  // Apply any trade a friend accepted while this device wasn't looking. The
  // accepting side settles inline when they click Accept, so this is really
  // for the person who SENT the offer — their collection should already be
  // right by the time they next open it.
  useTradeSettlement();

  // Once the collection has hydrated, silently bring stale card prices up to
  // date. Scryfall refreshes prices at most once a day, so this self-gates to
  // a daily, on-stale background refresh (no-op when offline / nothing stale /
  // attempted recently). Runs for guests and authed users alike — prices live
  // device-local.
  //
  // Keyed on `hasCards` as well as `hydrating`, NOT a one-shot ref: on a fresh
  // device the local cache is empty, so `hydrating` flips false with zero cards
  // and that first attempt no-ops — the cards only arrive later via the server
  // sync pull. Re-firing when the collection becomes non-empty is what lets a
  // freshly-synced device price itself instead of sitting at $0 until a manual
  // refresh. autoRefreshStalePrices is internally throttled (device-local 1h
  // key + in-flight guard + stale check), so the extra firings are cheap no-ops.
  const hydrating = useCollectionStore((s) => s.hydrating);
  const hasCards = useCollectionStore((s) => s.cards.length > 0);
  useEffect(() => {
    if (hydrating) return;
    void useCollectionStore.getState().autoRefreshStalePrices();
    // Same hydration gating: backfill oracleId on pre-oracleId cards so combos
    // and the Scryfall-query binder rule can join on it. One-shot per device,
    // local-only (no push) — see backfillOracleIds.
    void import('./lib/sync').then((s) => s.backfillOracleIds());
  }, [hydrating, hasCards]);

  // Pull the server snapshot once per authed user. The ref prevents a re-pull
  // on every status change while still firing again if a different user logs in
  // (e.g. logout → login as someone else). startSync runs in the background;
  // we don't block the UI on it — the store is hydrated from the local cache
  // first so the user sees their data immediately.
  useEffect(() => {
    if (status === 'guest') {
      syncStartedFor.current = null;
      // Guests run fully local — no account, no sync. Hydrate the cached
      // collection from IndexedDB so the collection page isn't stuck on its
      // loading state; signing in later promotes this data to the account.
      void hydrateLocal().catch((err) => {
        logger.warn('[sync] guest hydrate failed:', err);
        if (useCollectionStore.getState().hydrating) {
          useCollectionStore.setState({ hydrating: false });
        }
      });
      return;
    }
    if (status !== 'authed' || !userId) return;
    if (syncStartedFor.current === userId) return;
    syncStartedFor.current = userId;
    void startSync(userId).catch((err) => {
      logger.warn('[sync] startSync failed:', err);
      // Backstop: hydration is owned by the sync layer, but a failure here
      // (network down, wipeLocal throwing, etc.) must NOT leave the UI stuck
      // on "still hydrating" forever — the local IndexedDB cache is loaded
      // independently of sync success. Clear the flag so the app renders
      // whatever's cached instead of an indefinite loading state.
      if (useCollectionStore.getState().hydrating) {
        useCollectionStore.setState({ hydrating: false });
      }
    });
    // Silently keep the local card catalog fresh. No-op if it's already
    // up to date (cheap manifest check). Runs alongside startSync so the
    // user never waits on offline-data setup.
    void autoSyncOfflineData();
  }, [status, userId, username]);

  if (status === 'unknown' || status === 'loading') {
    // Public share links must remain reachable while auth bootstraps and
    // when no user is signed in — render the SharedView routes outside the
    // auth gate so a friend with a link doesn't get bounced to /auth.
    return (
      <Suspense fallback={<BootSplash />}>
        <Routes>
          <Route path="/s/:token" element={<SharedView />} />
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/d/:slug" element={<PublicDeckPage />} />
          <Route path="/gn/s/:token" element={<GameNightSeriesView />} />
          <Route path="/gn/i/:token" element={<GameNightInviteView />} />
          <Route path="/gn/:token" element={<GameNightView />} />
          <Route path="*" element={<BootSplash />} />
        </Routes>
      </Suspense>
    );
  }
  // Guests and signed-in users share the same app. Auth is opt-in (WotC Fan
  // Content policy forbids a sign-up wall): a guest works fully offline from
  // local storage; signing in only adds cross-device sync. AuthPage is a
  // normal, dismissable route reached from the header / Settings.
  return (
    <>
      <AutoLinkBanner />
      {/* Outer boundary: catches lazy routes that render outside <Layout/>
          (share views, game night). Layout has its own inner fallback. */}
      <Suspense fallback={<BootSplash />}>
        <Routes>
          <Route path="/s/:token" element={<SharedView />} />
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/d/:slug" element={<PublicDeckPage />} />
          <Route path="/gn/s/:token" element={<GameNightSeriesView />} />
          <Route path="/gn/i/:token" element={<GameNightInviteView />} />
          <Route path="/gn/:token" element={<GameNightView />} />
          {/* Root: the public marketing landing for first-time/logged-out
            visitors (and search-engine crawlers — empty storage + guest auth);
            authed users land on /home; returning guests fall back to
            /collection. Rendered outside <Layout> so the landing has no app
            chrome. Canonical homepage URL is `/`. */}
          <Route
            path="/"
            element={
              status === 'guest' && !hasEverVisited() ? (
                <WelcomePage />
              ) : status === 'authed' ? (
                <Navigate to="/home" replace />
              ) : (
                <Navigate to="/collection" replace />
              )
            }
          />
          {/* Legacy onboarding path → single canonical landing URL. */}
          <Route path="/welcome" element={<Navigate to="/" replace />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/auth/choose-username" element={<ChooseUsernamePage />} />
          <Route path="/oauth/callback" element={<OAuthCallbackLanding />} />
          <Route element={<Layout />}>
            {/* The default landing for authed users (w3-nav-activation) — the "/"
              and catch-all routes below send them here. Still reachable by
              direct URL for guests, who are never auto-routed here. */}
            <Route path="/home" element={<HomePage />} />
            <Route path="/collection" element={<CollectionHubLayout />}>
              <Route index element={<CollectionPage />} />
              <Route path="binders" element={<BindersIndexPage />} />
              <Route path="binders/:id" element={<BinderPage />} />
              <Route path="lists" element={<ListsPage />} />
              <Route path="lists/:id" element={<ListsPage />} />
              <Route path="combos" element={<CollectionCombosPage />} />
              <Route path="sets" element={<SetsPage />} />
              <Route path="sets/:code" element={<SetsPage />} />
              {/* The cube moved to the Decks hub — it's a thing you BUILD, like
                a deck, not a thing you own. Old links keep working. */}
              <Route path="cube" element={<LegacyCubeRedirect />} />
              <Route path="cube/:id" element={<LegacyCubeRedirect />} />
            </Route>

            <Route path="/decks" element={<DecksIndexPage />} />
            <Route path="/decks/discover" element={<DiscoverDecksPage />} />
            <Route path="/decks/saved" element={<SavedDecksPage />} />
            <Route path="/decks/new" element={<DeckNewPage />} />
            <Route path="/decks/new/brew" element={<BrewBuildPage />} />
            <Route path="/decks/compare" element={<DeckComparePage />} />
            <Route path="/decks/cube" element={<CubePage />} />
            <Route path="/decks/cube/:id" element={<CubePage />} />
            <Route path="/decks/:id" element={<DeckEditorPage />} />
            <Route path="/decks/:id/playtest" element={<PlaytestPage />} />
            <Route path="/play" element={<PlayPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/you" element={<YouPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/friends/:friendId" element={<FriendHubPage />} />
            <Route path="/trades" element={<TradesPage />} />
            <Route path="/pods" element={<PodsIndexPage />} />
            <Route path="/pods/:id" element={<PodHubPage />} />
            <Route path="/settings" element={<Navigate to="/you" replace />} />
            <Route
              path="/admin"
              element={isAdmin ? <AdminPage /> : <Navigate to="/collection" replace />}
            />
            <Route
              path="*"
              element={
                status === 'authed' ? (
                  <Navigate to="/home" replace />
                ) : (
                  <Navigate to="/collection" replace />
                )
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
