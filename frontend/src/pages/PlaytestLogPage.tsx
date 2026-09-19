import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDecksStore } from '@/store/decks';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  fingerprintDeck,
  loadPlaytestSnapshot,
  type PlaytestSnapshot,
} from '@/lib/playtest/session-snapshot';
import { LogDock } from '@/playtest/components/LogDock';
import '@/styles/playtest.css';

const KEY_PREFIX = 'spellcontrol:playtest:';

/**
 * The game log in its own window (`/decks/:id/playtest/log`), opened from the
 * docked log's pop-out button. It reads the same saved session the table
 * writes (debounced, per deck, in localStorage) and re-reads it on every
 * `storage` event for that key, so it follows the game live on a second
 * screen without any channel of its own. Closing it is just closing the
 * window; the table never depends on it.
 */
export function PlaytestLogPage() {
  const { id } = useParams<{ id: string }>();
  const deck = useDecksStore((s) => (id ? s.decks.find((d) => d.id === id) : undefined));
  const hydrated = useDecksStore((s) => s.hydrated);
  const [snapshot, setSnapshot] = useState<PlaytestSnapshot | null>(null);
  useDocumentTitle(deck ? `Log · ${deck.name}` : 'Log');

  useEffect(() => {
    if (!deck) return;
    const read = () => setSnapshot(loadPlaytestSnapshot(deck.id, fingerprintDeck(deck)));
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === KEY_PREFIX + deck.id) read();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [deck]);

  if (!hydrated) {
    return (
      <div className="page-loader page-loader--message" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span className="page-loader-message">Loading log…</span>
      </div>
    );
  }
  if (!deck) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">Deck not found.</p>
        <p className="empty-state-hint">Close this window and open the log from the table.</p>
      </div>
    );
  }

  return (
    <div className="playtest-page">
      <LogDock log={snapshot?.gameLog ?? []} variant="page" onClose={() => window.close()} />
    </div>
  );
}
