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
// Split from the former styles/deck-builder.css — imported in original cascade order (byte-identical).
import './styles/deck-builder-page.css';
import './styles/deck-builder-commander.css';
import './styles/deck-builder-settings.css';
import './styles/deck-builder-display.css';
import './styles/deck-builder-card-list.css';
import './styles/deck-builder-analysis.css';
import './styles/deck-builder-decks-index.css';
import './styles/deck-builder-editor.css';
import './styles/deck-builder-customizer.css';
import './styles/deck-builder-export.css';
import './styles/deck-builder-card-search.css';
import './styles/deck-builder-test-hand.css';
import './styles/deck-builder-combos.css';
import './styles/deck-builder-tabs.css';
import './styles/deck-builder-combos-list.css';
import './styles/deck-builder-row-qty.css';
import './styles/deck-builder-toast.css';
import './styles/deck-builder-binder-slot.css';
import './styles/deck-builder-responsive.css';
import './styles/deck-builder-import-dialog.css';
import './styles/deck-builder-deck-extras.css';
import './styles/deck-builder-binders-index.css';
import './styles/deck-builder-analysis-panel.css';
import './styles/deck-builder-commander-profile.css';
import './styles/deck-builder-guided.css';
import './styles/deck-builder-skeleton.css';
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
import { loadCardSimilar } from './deck-builder/services/deckBuilder/cardSimilar';
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
// Likewise the EDHREC substitute index, so the Coach's substitute suggestions
// rank by deck co-occurrence rather than the heuristic fallback. Cached/deduped.
void loadCardSimilar();
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
