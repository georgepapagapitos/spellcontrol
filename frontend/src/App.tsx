import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CollectionPage } from './pages/CollectionPage';
import { BinderPage } from './pages/BinderPage';
import { BindersIndexPage } from './pages/BindersIndexPage';
import { DecksIndexPage } from './pages/DecksIndexPage';
import { DeckNewPage } from './pages/DeckNewPage';
import { DeckEditorPage } from './pages/DeckEditorPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { PlayPage } from './pages/PlayPage';
import AuthPage from './pages/AuthPage';
import { useAuth } from './store/auth';
import { useCollectionStore } from './store/collection';
import { startSync } from './lib/sync';

export default function App() {
  const status = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id);
  const bootstrap = useAuth((s) => s.bootstrap);
  const syncStartedFor = useRef<string | null>(null);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Pull the server snapshot once per authed user. The ref prevents a re-pull
  // on every status change while still firing again if a different user logs in
  // (e.g. logout → login as someone else). startSync runs in the background;
  // we don't block the UI on it — the store is hydrated from the local cache
  // first so the user sees their data immediately.
  useEffect(() => {
    if (status === 'guest') {
      syncStartedFor.current = null;
      return;
    }
    if (status !== 'authed' || !userId) return;
    if (syncStartedFor.current === userId) return;
    syncStartedFor.current = userId;
    void startSync(userId).catch((err) => {
      console.warn('[sync] startSync failed:', err);
      // Backstop: hydration is owned by the sync layer, but a failure here
      // (network down, wipeLocal throwing, etc.) must NOT leave the UI stuck
      // on "still hydrating" forever — the local IndexedDB cache is loaded
      // independently of sync success. Clear the flag so the app renders
      // whatever's cached instead of an indefinite loading state.
      if (useCollectionStore.getState().hydrating) {
        useCollectionStore.setState({ hydrating: false });
      }
    });
  }, [status, userId]);

  if (status === 'unknown' || status === 'loading') {
    return <div className="auth-page" aria-busy="true" />;
  }
  if (status === 'guest') {
    return <AuthPage />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/collection" replace />} />
        <Route path="/collection" element={<CollectionPage />} />
        <Route path="/binder" element={<Navigate to="/binders" replace />} />
        <Route path="/binders" element={<BindersIndexPage />} />
        <Route path="/binders/:id" element={<BinderPage />} />
        <Route path="/decks" element={<DecksIndexPage />} />
        <Route path="/decks/new" element={<DeckNewPage />} />
        <Route path="/decks/:id" element={<DeckEditorPage />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/collection" replace />} />
      </Route>
    </Routes>
  );
}
