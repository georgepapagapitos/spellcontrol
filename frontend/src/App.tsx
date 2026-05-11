import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CollectionPage } from './pages/CollectionPage';
import { BinderPage } from './pages/BinderPage';
import { DecksIndexPage } from './pages/DecksIndexPage';
import { DeckNewPage } from './pages/DeckNewPage';
import { DeckEditorPage } from './pages/DeckEditorPage';
import AuthPage from './pages/AuthPage';
import { useAuth } from './store/auth';
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
  // (e.g. logout → login as someone else).
  useEffect(() => {
    if (status !== 'authed' || !userId) return;
    if (syncStartedFor.current === userId) return;
    syncStartedFor.current = userId;
    void startSync().catch((err) => {
      console.warn('[sync] startSync failed:', err);
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
        <Route path="/binder" element={<BinderPage />} />
        <Route path="/decks" element={<DecksIndexPage />} />
        <Route path="/decks/new" element={<DeckNewPage />} />
        <Route path="/decks/:id" element={<DeckEditorPage />} />
        <Route path="*" element={<Navigate to="/collection" replace />} />
      </Route>
    </Routes>
  );
}
