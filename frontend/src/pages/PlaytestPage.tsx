import { useParams } from 'react-router-dom';
import { useDecksStore } from '@/store/decks';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import { PlaytestSession } from '@/playtest/components/PlaytestSession';
import '@/styles/playtest.css';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * Playtest one of YOUR decks. Resolves the deck from the decks store, decides
 * where "back" goes, and hands off to `PlaytestSession` — the same component
 * `PublicDeckPlaytestPage` uses for a shared or public deck, so both go through
 * one session implementation rather than two copies that drift.
 */
export function PlaytestPage() {
  const { id } = useParams<{ id: string }>();
  const decks = useDecksStore((s) => s.decks);
  const hydrated = useDecksStore((s) => s.hydrated);
  // Same test as use-online-table, and it has to stay the same: this playtest
  // is the seat's board only when it IS the seat's deck. Holding a seat alone
  // used to be enough, which relabelled every deck's goldfish as "Your board"
  // and pointed its back link at a game it had nothing to do with.
  const online = usePlayStore((s) => s.online);
  const userId = useAuth((s) => s.user?.id);
  const mySeat =
    online && userId != null ? (online.players.find((p) => p.userId === userId) ?? null) : null;
  const tableCode =
    online && mySeat && mySeat.deckId != null && mySeat.deckId === id ? online.code : null;

  const deck = id ? decks.find((d) => d.id === id) : undefined;
  // A cold device has an empty store while the first pull is in flight —
  // that is not "deck not found" (same class as #1937; measured at ~1s of
  // "It may have been deleted" with a live Back door, playtest batch 7).
  const awaitingFirstPull = useAwaitingFirstPull();
  useDocumentTitle(deck ? `Playtest · ${deck.name}` : undefined);

  if (!hydrated || (awaitingFirstPull && !deck)) {
    return (
      <div className="page-loader page-loader--message" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span className="page-loader-message">Loading deck…</span>
      </div>
    );
  }
  if (!deck) {
    return (
      <EmptyState
        tagline="Deck not found."
        hint="It may have been deleted. Pick another deck to playtest."
        actions={
          <Button variant="primary" to="/decks">
            Back to decks
          </Button>
        }
      />
    );
  }

  const back = tableCode
    ? { label: `Game ${tableCode}`, to: '/play/online' }
    : { label: deck.name, to: `/decks/${deck.id}` };

  return (
    <PlaytestSession
      deck={deck}
      back={back}
      emptyHint="This deck has no cards. Add some and the goldfish table will be waiting."
    />
  );
}
