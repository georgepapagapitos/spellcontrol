import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDecksStore } from '@/store/decks';
import { useConfirm } from '@/lib/use-confirm';
import {
  clearPlaytestSnapshot,
  fingerprintDeck,
  isResumeWorthy,
  loadPlaytestSnapshot,
  type PlaytestSnapshot,
} from '@/lib/playtest/session-snapshot';
import type { Deck } from '@/store/decks';
import { deckToPlaytestInit } from '@/playtest/lib/deck-to-playtest';
import { usePlaytestStore, flushPendingPlaytestSnapshot, tryRecordSession } from '@/playtest/store';
import { PlaytestBoard } from '@/playtest/components/PlaytestBoard';
import '@/styles/playtest.css';

export function PlaytestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const decks = useDecksStore((s) => s.decks);
  const hydrated = useDecksStore((s) => s.hydrated);
  const state = usePlaytestStore((s) => s.state);
  const init = usePlaytestStore((s) => s.init);
  const hydrate = usePlaytestStore((s) => s.hydrate);
  const teardown = usePlaytestStore((s) => s.teardown);
  const storeDeckId = usePlaytestStore((s) => s.deckId);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const deck = id ? decks.find((d) => d.id === id) : undefined;

  // Tracks which deck id we've already asked resume-vs-fresh for, so the
  // prompt fires once per deck visit. A ref (not state) — it only gates
  // this effect and shouldn't itself trigger a render.
  const checkedDeckIdRef = useRef<string | null>(null);
  // A deck whose cards can't be turned into a playable session (a malformed
  // entry, a corrupt snapshot) used to leave the "Shuffling…" spinner up
  // forever with no way out but the browser's back button.
  const [initFailed, setInitFailed] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!deck) return;
    if (storeDeckId === deck.id) return;
    if (checkedDeckIdRef.current === deck.id) return; // already asked (or none to ask) this visit
    checkedDeckIdRef.current = deck.id;
    // Commit any still-debounced write for whatever deck was previously
    // loaded before we touch the store for this one (route can swap decks
    // without unmounting the page).
    flushPendingPlaytestSnapshot();

    // Both entry points funnel through here so a throw anywhere in
    // deck→session conversion surfaces as a real error state, not a spinner
    // that never resolves.
    function startSession(run: () => void) {
      try {
        run();
      } catch {
        setInitFailed(true);
      }
    }

    async function offerResume(forDeck: Deck, snap: PlaytestSnapshot) {
      const resume = await confirm({
        title: 'Resume game?',
        body: `Turn ${snap.state.turn} is still in progress. Starting fresh discards that game.`,
        confirmLabel: 'Resume',
        cancelLabel: 'Start fresh',
      });
      if (resume) {
        startSession(() => hydrate(forDeck.id, snap));
      } else {
        // Declining a resume-worthy snapshot in favor of "Start fresh" is a
        // session boundary the live store never saw (it never loaded this
        // state) — capture it into the deck's history (E141) before discarding.
        tryRecordSession(
          forDeck.id,
          snap.state,
          snap.gameLog ?? [],
          snap.mulliganCount,
          snap.resistanceLevel !== 'off'
        );
        clearPlaytestSnapshot(forDeck.id);
        startSession(() => init(forDeck.id, deckToPlaytestInit(forDeck)));
      }
    }

    const snapshot = loadPlaytestSnapshot(deck.id, fingerprintDeck(deck));
    if (snapshot && isResumeWorthy(snapshot)) {
      void offerResume(deck, snapshot);
      return;
    }
    init(deck.id, deckToPlaytestInit(deck));
  }, [hydrated, deck, storeDeckId, init, hydrate, confirm]);

  useEffect(
    () => () => {
      flushPendingPlaytestSnapshot();
      teardown();
    },
    [teardown]
  );

  if (!hydrated) {
    return (
      <div className="page-loader page-loader--message" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span className="page-loader-message">Loading deck…</span>
      </div>
    );
  }
  if (!deck) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">Deck not found</p>
        <p className="empty-state-hint">It may have been deleted. Pick another deck to playtest.</p>
        <div className="empty-state-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/decks')}>
            Back to decks
          </button>
        </div>
      </div>
    );
  }
  if (deck.cards.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">Nothing to playtest yet</p>
        <p className="empty-state-hint">
          This deck has no cards. Add some and the goldfish table will be waiting.
        </p>
        <div className="empty-state-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate(`/decks/${deck.id}`)}
          >
            Add cards
          </button>
        </div>
      </div>
    );
  }
  if (initFailed) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">Couldn't start this playtest</p>
        <p className="empty-state-hint">
          Something in this deck couldn't be dealt into a game. Try again, or open the deck to check
          its cards.
        </p>
        <div className="empty-state-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              // Clear any snapshot that might itself be the problem, and let
              // the effect re-run from scratch for this deck.
              clearPlaytestSnapshot(deck.id);
              checkedDeckIdRef.current = null;
              setInitFailed(false);
            }}
          >
            Try again
          </button>
          <button type="button" className="btn" onClick={() => navigate(`/decks/${deck.id}`)}>
            Back to deck
          </button>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <>
        <div className="page-loader page-loader--message" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="page-loader-message">Shuffling…</span>
        </div>
        {confirmDialog}
      </>
    );
  }

  return (
    <div className="playtest-page">
      <header className="playtest-page__header">
        <button type="button" onClick={() => navigate(`/decks/${deck.id}`)}>
          ← {deck.name}
        </button>
        <h1>Playtest</h1>
      </header>
      <PlaytestBoard state={state} />
      {confirmDialog}
    </div>
  );
}
