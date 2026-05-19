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
import { bootstrapTheme } from './store/theme';
import { loadTaggerData } from './deck-builder/services/tagger/client';

bootstrapTheme();
// Kick off tagger data load eagerly so the deck generator can attach role
// counts on the first build. Safe to call multiple times — the client caches.
void loadTaggerData();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
