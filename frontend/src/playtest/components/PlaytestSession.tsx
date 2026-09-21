import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useNarrowViewport } from '@/playtest/hooks/use-narrow-viewport';
import { usePrintedBodies } from '@/playtest/hooks/use-printed-bodies';

export interface PlaytestBackTarget {
  label: string;
  to: string;
}

interface Props {
  /** The deck to goldfish. Either one of the viewer's own (from the decks
   *  store) or a shared/public deck adapted by `lib/public-deck-to-deck.ts` —
   *  this component does not care which, and must not reach into any store to
   *  find out. */
  deck: Deck;
  /**
   * True when `deck` is NOT in the viewer's decks store — a shared or public
   * deck. The playtest store otherwise resolves the deck by id for the
   * snapshot migration and the session record, and a miss silently degrades
   * both (a resumed Commander game comes back at 20 life; every land-derived
   * stat reads as if the deck had none).
   */
  external?: boolean;
  back: PlaytestBackTarget;
  /** Heading above the board. */
  title: string;
  /** Rendered in the "this deck has no cards" state — the owner gets an "Add
   *  cards" route, a visitor only gets the way back. */
  emptyHint: string;
}

/**
 * The playtest session itself: snapshot/resume, init, teardown, and every
 * state the board can be in. Split out of `PlaytestPage` so a shared or public
 * deck can be goldfished through the exact same machinery as your own — one
 * implementation, two deck sources. The page above decides where the deck
 * comes from, what "back" means, and what to say when it's empty.
 */
export function PlaytestSession({ deck, external: isExternal, back, title, emptyHint }: Props) {
  const navigate = useNavigate();
  // Passed to the store so it never has to look this deck up by id.
  const external = isExternal ? deck : undefined;
  const state = usePlaytestStore((s) => s.state);
  const init = usePlaytestStore((s) => s.init);
  const hydrate = usePlaytestStore((s) => s.hydrate);
  const teardown = usePlaytestStore((s) => s.teardown);
  const storeDeckId = usePlaytestStore((s) => s.deckId);
  const { confirm, dialog: confirmDialog } = useConfirm();
  // The table tier (≥1024px) has no chrome rows at all — back-navigation and
  // the deck's name live in the board's own top-right game menu instead, so
  // this header row is narrow-only. (Short landscape already dropped it in
  // CSS; that tier is a subset of narrow, so nothing there changes.)
  const isNarrow = useNarrowViewport();
  // Backfills printed power/toughness the deck's own cards are missing, so a
  // creature on the board shows a P/T box whatever era the deck was built in.
  usePrintedBodies(deck);

  // The deck id a resume-vs-fresh prompt is currently open for. It gates only
  // the prompt: while the confirm dialog is up the effect below can re-run
  // (deps churn) and must not stack a second dialog. It is NOT a "done this
  // deck" latch — an earlier version latched on the deck id, and React's
  // StrictMode remount (mount → teardown → mount) then left the page on
  // "Shuffling…" forever: the teardown cleared the store, the re-run saw the
  // latch and bailed, and nothing ever called init() again. Whether a
  // session exists is answered by `storeDeckId`, so that is the only latch.
  const promptingForRef = useRef<string | null>(null);
  // A deck whose cards can't be turned into a playable session (a malformed
  // entry, a corrupt snapshot) used to leave the "Shuffling…" spinner up
  // forever with no way out but the browser's back button.
  const [initFailed, setInitFailed] = useState(false);

  useEffect(() => {
    if (storeDeckId === deck.id) return;
    if (promptingForRef.current === deck.id) return; // resume prompt already open
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
      promptingForRef.current = forDeck.id;
      let resume: boolean;
      try {
        resume = await confirm({
          title: 'Resume game?',
          body: `Turn ${snap.state.turn} is still in progress. Starting fresh discards that game.`,
          confirmLabel: 'Resume',
          cancelLabel: 'Start fresh',
        });
      } finally {
        promptingForRef.current = null;
      }
      if (resume) {
        startSession(() => hydrate(forDeck.id, snap, external));
      } else {
        // Declining a resume-worthy snapshot in favor of "Start fresh" is a
        // session boundary the live store never saw (it never loaded this
        // state) — capture it into the deck's history (E141) before discarding.
        tryRecordSession(
          forDeck.id,
          snap.state,
          snap.gameLog ?? [],
          snap.mulliganCount,
          snap.resistanceLevel !== 'off',
          forDeck
        );
        clearPlaytestSnapshot(forDeck.id);
        startSession(() => init(forDeck.id, deckToPlaytestInit(forDeck), external));
      }
    }

    const snapshot = loadPlaytestSnapshot(deck.id, fingerprintDeck(deck));
    if (snapshot && isResumeWorthy(snapshot)) {
      void offerResume(deck, snapshot);
      return;
    }
    startSession(() => init(deck.id, deckToPlaytestInit(deck), external));
  }, [deck, external, storeDeckId, init, hydrate, confirm]);

  useEffect(
    () => () => {
      flushPendingPlaytestSnapshot();
      teardown();
    },
    [teardown]
  );

  if (deck.cards.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">Nothing to playtest yet.</p>
        <p className="empty-state-hint">{emptyHint}</p>
        <div className="empty-state-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate(back.to)}>
            {back.label}
          </button>
        </div>
      </div>
    );
  }
  if (initFailed) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">Couldn't start this playtest.</p>
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
              promptingForRef.current = null;
              setInitFailed(false);
            }}
          >
            Try again
          </button>
          <button type="button" className="btn" onClick={() => navigate(back.to)}>
            {back.label}
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
      {isNarrow && (
        <header className="playtest-page__header">
          <button type="button" onClick={() => navigate(back.to)}>
            ← {back.label}
          </button>
          <h1>{title}</h1>
        </header>
      )}
      <PlaytestBoard state={state} backLabel={back.label} onBack={() => navigate(back.to)} />
      {confirmDialog}
    </div>
  );
}
