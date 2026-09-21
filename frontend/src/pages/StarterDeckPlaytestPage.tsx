import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchProduct } from '@/lib/api';
import { importToDeck } from '@/lib/import-to-deck';
import { starterDeckLocalId } from '@/lib/starter-decks';
import { userMessage } from '@/lib/user-error';
import { useDocumentTitle } from '@/lib/use-document-title';
import { PlaytestSession } from '@/playtest/components/PlaytestSession';
import { toast } from '@/store/toasts';
import type { Deck } from '@/store/decks';
import '@/styles/playtest.css';
import './StarterDeckPlaytestPage.css';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** `fileName` is which starter this deck is, so a changed param can't keep
      showing the previous board while the new one resolves. */
  | { status: 'ready'; fileName: string; deck: Deck };

/**
 * A preconstructed Commander deck, on a board, at
 * `/decks/starters/:fileName/playtest`.
 *
 * The board itself is the same `PlaytestSession` in `external` mode that
 * `/decks/goldfish` and the public share links use: the deck is resolved here
 * and lives in this component. Nothing is written to the decks store, and the
 * cards are never committed to a snapshot — they come from the product
 * endpoint every time, so a starter always reflects the current card cache.
 *
 * This is also the board an online seat on a starter opens (see
 * `lib/starter-decks.ts:deckBoardPath`), which is why it is a real route with
 * a resolvable id and not a piece of picker state. The table link then holds
 * by construction: `useTableSeat` seats a board when the seat's `deckId` is
 * the deck the board is playing, and both are `starter:<fileName>`.
 */
export function StarterDeckPlaytestPage() {
  const { fileName = '' } = useParams<{ fileName: string }>();
  const [state, setState] = useState<State>(() =>
    fileName
      ? { status: 'loading' }
      : { status: 'error', message: "That starter deck link doesn't name a deck." }
  );
  const ready = state.status === 'ready' && state.fileName === fileName ? state : null;
  useDocumentTitle(ready ? `Playtest: ${ready.deck.name}` : 'Starter deck');

  useEffect(() => {
    if (!fileName) return;
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await fetchProduct(fileName);
        if (cancelled) return;
        // Say what was dropped rather than quietly dealing a short deck — the
        // board is about to take over the screen, so this is a toast.
        const missed = resolved.deck.unresolvedNames.length;
        if (missed > 0) {
          toast.show({
            tone: 'warn',
            message: `${missed} card${missed === 1 ? '' : 's'} in this deck couldn't be looked up and ${missed === 1 ? 'is' : 'are'} not in this game.`,
          });
        }
        setState({
          status: 'ready',
          fileName,
          deck: importToDeck(resolved.deck, starterDeckLocalId(fileName), resolved.product.name),
        });
      } catch (e) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: userMessage(e, "Couldn't load that starter deck. Try again."),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileName]);

  if (ready) {
    return (
      <PlaytestSession
        deck={ready.deck}
        external
        back={{ label: 'Decks', to: '/decks' }}
        title="Starter deck"
        emptyHint="That starter deck came back empty. Pick another one from Decks."
      />
    );
  }

  return (
    <div className="starter-deck-page">
      {state.status !== 'error' ? (
        <p className="starter-deck-status">
          <span className="spinner" aria-hidden="true" /> Dealing the starter deck…
        </p>
      ) : (
        <>
          <p className="starter-deck-status" role="alert">
            {state.message}
          </p>
          <Link to="/decks" className="btn">
            Back to decks
          </Link>
        </>
      )}
    </div>
  );
}
