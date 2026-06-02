import { logger } from '@/lib/logger';
import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CollectionHubLayout } from './components/CollectionHubLayout';
import { CollectionPage } from './pages/CollectionPage';
import { BinderPage } from './pages/BinderPage';
import { BindersIndexPage } from './pages/BindersIndexPage';
import { ListsPage } from './pages/ListsPage';
import { DecksIndexPage } from './pages/DecksIndexPage';
import { DeckNewPage } from './pages/DeckNewPage';
import { GuidedBuildPage } from './pages/GuidedBuildPage';
import { DeckEditorPage } from './pages/DeckEditorPage';
import { PlaytestPage } from './pages/PlaytestPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { PlayPage } from './pages/PlayPage';
import AuthPage from './pages/AuthPage';
import ChooseUsernamePage from './pages/ChooseUsernamePage';
import { SharedView } from './pages/SharedView';
import { useAuth } from './store/auth';
import { useCollectionStore } from './store/collection';
import { startSync, hydrateLocal } from './lib/sync';
import { autoSyncOfflineData, registerOfflineSyncOnResume } from './lib/offline/auto-sync';
import { initDeepLinks } from './lib/deep-links';
import { AutoLinkBanner } from './components/AutoLinkBanner';
import { useFirstRunGate } from './lib/use-first-run-gate';

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
    <div className="auth-page">
      <div className="auth-card auth-callback-card" role="status">
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{message}</p>
        {hasPayload && isAndroid ? (
          <a className="auth-submit auth-submit-link" href={intentUrl}>
            Open SpellControl
          </a>
        ) : null}
        <a className="auth-back" href="/">
          Continue on the web instead
        </a>
      </div>
    </div>
  );
}

export default function App() {
  const status = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id);
  const username = useAuth((s) => s.user?.username);
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

  // Re-check the offline card catalog whenever the app returns to the
  // foreground. No-op on web; throttled so frequent resumes don't spam the
  // manifest endpoint. Keeps a long-lived native session from drifting onto
  // stale data between cold starts.
  useEffect(() => registerOfflineSyncOnResume(), []);

  // Once the collection has hydrated, silently bring stale card prices up to
  // date. Scryfall refreshes prices at most once a day, so this self-gates to
  // a daily, on-stale background refresh (no-op when offline / nothing stale /
  // attempted recently). Runs for guests and authed users alike — prices live
  // device-local. The ref keeps it to one attempt per mount.
  const hydrating = useCollectionStore((s) => s.hydrating);
  const priceRefreshTried = useRef(false);
  useEffect(() => {
    if (hydrating || priceRefreshTried.current) return;
    priceRefreshTried.current = true;
    void useCollectionStore.getState().autoRefreshStalePrices();
  }, [hydrating]);

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
    // `username` is read at the time startSync is invoked; the dialog uses
    // it for display only, so it's fine if it's missing during the first
    // tick after sign-in (renders "this account").
    void startSync(userId, username).catch((err) => {
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
      <Routes>
        <Route path="/s/:token" element={<SharedView />} />
        <Route path="*" element={<div className="auth-page" aria-busy="true" />} />
      </Routes>
    );
  }
  // Guests and signed-in users share the same app. Auth is opt-in (WotC Fan
  // Content policy forbids a sign-up wall): a guest works fully offline from
  // local storage; signing in only adds cross-device sync. AuthPage is a
  // normal, dismissable route reached from the header / Settings.
  return (
    <>
      <AutoLinkBanner />
      <Routes>
        <Route path="/s/:token" element={<SharedView />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/choose-username" element={<ChooseUsernamePage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackLanding />} />
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/collection" replace />} />

          <Route path="/collection" element={<CollectionHubLayout />}>
            <Route index element={<CollectionPage />} />
            <Route path="binders" element={<BindersIndexPage />} />
            <Route path="binders/:id" element={<BinderPage />} />
            <Route path="lists" element={<ListsPage />} />
            <Route path="lists/:id" element={<ListsPage />} />
          </Route>

          <Route path="/decks" element={<DecksIndexPage />} />
          <Route path="/decks/new" element={<DeckNewPage />} />
          <Route path="/decks/new/guided" element={<GuidedBuildPage />} />
          <Route path="/decks/:id" element={<DeckEditorPage />} />
          <Route path="/decks/:id/playtest" element={<PlaytestPage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/collection" replace />} />
        </Route>
      </Routes>
    </>
  );
}
