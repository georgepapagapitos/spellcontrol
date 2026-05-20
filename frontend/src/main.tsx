import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import 'mana-font/css/mana.min.css';
import './styles/global.css';
import './styles/holographic.css';
import './styles/themes.css';
import './styles/deck-builder.css';
import './styles/play.css';
import './styles/shared.css';
import { bootstrapTheme, useThemeStore } from './store/theme';
import { loadTaggerData } from './deck-builder/services/tagger/client';
import { registerPwa } from './lib/register-pwa';
import { tagPlatform, syncStatusBar, initKeyboard } from './lib/platform';

tagPlatform();
bootstrapTheme();
void syncStatusBar();
void initKeyboard();
// Re-sync the native status bar icons whenever the user switches themes;
// no-op on web.
useThemeStore.subscribe(() => {
  void syncStatusBar();
});
// Kick off tagger data load eagerly so the deck generator can attach role
// counts on the first build. Safe to call multiple times — the client caches.
void loadTaggerData();
// Register the service worker for installable / offline-capable behavior.
// No-op in dev (devOptions.enabled = false in vite.config.ts).
void registerPwa();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
