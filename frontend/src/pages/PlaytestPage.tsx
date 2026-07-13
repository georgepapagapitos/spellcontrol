import { useEffect, useRef } from 'react';
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

    async function offerResume(forDeck: Deck, snap: PlaytestSnapshot) {
      const resume = await confirm({
        title: 'Resume game?',
        body: `Turn ${snap.state.turn} is still in progress. Starting fresh discards that game.`,
        confirmLabel: 'Resume',
        cancelLabel: 'Start fresh',
      });
      if (resume) {
        hydrate(forDeck.id, snap);
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
        init(forDeck.id, deckToPlaytestInit(forDeck));
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
    return <div className="playtest-loading">Loading deck…</div>;
  }
  if (!deck) {
    return (
      <div className="playtest-missing">
        <p>Deck not found.</p>
        <button type="button" onClick={() => navigate('/decks')}>
          Back to decks
        </button>
      </div>
    );
  }
  if (!state) {
    return (
      <>
        <div className="playtest-loading">Shuffling…</div>
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
