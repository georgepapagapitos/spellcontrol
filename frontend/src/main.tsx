import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import 'mana-font/css/mana.min.css';
import 'keyrune/css/keyrune.min.css';
// Split from the former styles/global.css — imported in original cascade order
// so the split is a pure file-organization change (no behavior change).
import './styles/tokens.css';
import './styles/base-layout.css';
import './styles/import-upload.css';
import './styles/forms-banners.css';
import './styles/binder-hero.css';
import './styles/search-controls.css';
import './styles/stats-breakdown.css';
import './styles/tabs.css';
import './styles/binder-grid-slots.css';
import './styles/tooltip-legend.css';
import './styles/feedback-spinner.css';
import './styles/binder-nav.css';
import './styles/modals-dialogs.css';
import './styles/binder-rules-editor.css';
import './styles/footer-card-preview.css';
import './styles/binder-spread.css';
import './styles/responsive-nav.css';
import './styles/collection.css';
import './styles/auth.css';
import './styles/settings-sync.css';
import './styles/binder-card-management.css';
import './styles/admin-scanner.css';
import './styles/holographic.css';
import './styles/themes.css';
import './styles/deck-builder.css';
// Split from the former styles/play.css — imported in original cascade order.
import './styles/play-setup.css';
import './styles/play-board.css';
import './styles/play-panel-menus.css';
import './styles/play-history-inline.css';
import './styles/play-effects.css';
import './styles/play-enhancements.css';
import './styles/play-layout-editor.css';
import './styles/play-counters-panel.css';
import './styles/shared.css';
import { bootstrapTheme, useThemeStore } from './store/theme';
import { loadTaggerData } from './deck-builder/services/tagger/client';
import { registerPwa } from './lib/register-pwa';
import { tagPlatform, syncStatusBar } from './lib/platform';
import { initKeyboardLayer } from './lib/keyboard';

tagPlatform();
bootstrapTheme();
void syncStatusBar();
initKeyboardLayer();
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
